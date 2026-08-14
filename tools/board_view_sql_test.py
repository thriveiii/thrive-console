"""console_board: the board's one server-computed stage, proven against real Postgres.

The board's oscillation and its fabricated states came from the client composing each card's stage at render
time from several scattered sources that load asynchronously. This brief moves the computation server-side:
docs/supabase-board-view.sql defines console_board, which computes each opportunity's canonical stage and
display fields in ONE deterministic pass over the base tables. This test applies that exact SQL file to a
throwaway Postgres cluster, seeds one card per ladder branch (the real column shapes the client writes), and
asserts the computed stage and counts. It proves the send-gate that ends the fabrication (a page with opens
but zero sends is 'live', never 'opened'), the self-view exclusion, the manual-contact send, the null-status
send, the declared-terminus override, and determinism (two runs are byte-identical; one row per opp).

Skips cleanly (exit 0) where Postgres is unavailable (no psql, or no unprivileged user to run it), so the
bed stays green on a machine without a local cluster; the live gate is Thyab running the SQL on Supabase.
"""
import os, shutil, subprocess, tempfile, getpass, sys

ROOT = "/home/user/thrive-console"
VIEW_SQL = os.path.join(ROOT, "docs/supabase-board-view.sql")

def skip(msg):
    print("SKIP board_view_sql_test: " + msg)
    raise SystemExit(0)

pgbin = None
for cand in ("/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin", "/usr/lib/postgresql/14/bin"):
    if os.path.isdir(cand):
        pgbin = cand; break
if not pgbin or not shutil.which("psql"):
    skip("no local Postgres (psql / server binaries) available")

# Postgres refuses to run as root. If we are root, run the cluster as the unprivileged 'postgres' user.
runas = None
if os.geteuid() == 0:
    import pwd
    try: pwd.getpwnam("postgres")
    except KeyError: skip("running as root and no 'postgres' user to drop to")
    runas = "postgres"

work = "/tmp/pgtest_boardview"
sock = os.path.join(work, "sock")
data = os.path.join(work, "data")

SEED = r"""
-- The REAL production column types (docs/supabase-stage1.sql + docs/supabase-mail-migrate.sql):
-- console_mail.ts is timestamptz; console_inbound.ts and console_hits.ts are TEXT. Seeding these exact
-- types is what makes this test catch the ''::timestamptz cast bug: a nullif(m.ts,'') on a timestamptz
-- column fails to install, so the "view applies cleanly" check below is the fails-when-broken guard.
create table console_opps (slug text primary key, business text, stage text, published boolean, archived boolean, outreach_subject text, outreach_text text, data jsonb, up bigint);
create table console_mail (id text primary key, opp text, status text, to_addr text, subject text, ts timestamptz, actor text, data jsonb, up bigint);
create table console_inbound (id text primary key, opp text, kind text, bounce text, ts text, data jsonb, up bigint);
create table console_hits (id text primary key, slug text, type text, ts text, self boolean, data jsonb);
create table console_pages (slug text primary key, html text);
insert into console_opps(slug,business,stage,published,archived,outreach_subject,outreach_text,data,up) values
 ('rise','Rise Dance','',true,false,'','', '{}'::jsonb, 1000),
 ('drafty','Draft Co','',false,false,'','', '{}'::jsonb, 1000),
 ('ready','Ready Co','',true,false,'','', '{}'::jsonb, 1000),
 ('sentco','Sent Co','',true,false,'','', '{}'::jsonb, 1000),
 ('openco','Open Co','',true,false,'','', '{}'::jsonb, 1000),
 ('preopen','PreOpen Co','',true,false,'','', '{}'::jsonb, 1000),
 ('replyco','Reply Co','',true,false,'','', '{}'::jsonb, 1000),
 ('bounceco','Bounce Co','',true,false,'','', '{}'::jsonb, 1000),
 ('wonco','Won Co','won',true,false,'','', '{}'::jsonb, 1000),
 ('manualco','Manual Co','',true,false,'','', '{"manual_contacts":[{"sent_on":"2026-08-01"}]}'::jsonb, 1000);
insert into console_mail(id,opp,status,ts,data) values
 ('m_sent','sentco','sent','2026-08-01T10:00:00Z','{}'),
 ('m_open','openco','sent','2026-08-01T10:00:00Z','{}'),
 ('m_pre','preopen','sent','2026-08-05T10:00:00Z','{}'),
 ('m_reply','replyco','sent','2026-08-01T10:00:00Z','{}'),
 ('m_bounce','bounceco','sent','2026-08-01T10:00:00Z','{}'),
 ('m_null','sentco', null ,'2026-07-01T10:00:00Z','{}'),
 ('m_in','replyco', null ,'2026-08-03T10:00:00Z','{"direction":"in"}');
insert into console_hits(id,slug,type,ts,self) values
 ('h_rise1','rise','open','2026-08-02T10:00:00Z',false),
 ('h_rise2','rise','open','2026-08-03T10:00:00Z',false),
 ('h_open','openco','open','2026-08-02T10:00:00Z',false),
 ('h_pre','preopen','open','2026-08-01T10:00:00Z',false),
 ('h_self','openco','open','2026-08-02T11:00:00Z',true);
insert into console_inbound(id,opp,kind,bounce,ts,data) values
 ('i_reply','replyco','reply','', '2026-08-03T09:00:00Z','{}'),
 ('i_bounce','bounceco','auto','hard','2026-08-02T09:00:00Z','{}');
insert into console_pages(slug,html) values ('ready','<b>x</b>');
"""

EXPECT = {
    "rise": ("live", 0, 0),      # opens but ZERO sends -> send-gated -> live, never opened (the fabrication, fixed)
    "drafty": ("draft", 0, 0),   # no page/email/send
    "ready": ("live", 0, 0),     # a page, no send
    "sentco": ("sent", 2, 0),    # two sends (one null-status), no open
    "openco": ("opened", 1, 1),  # a send + an open after it; the self visit excluded (count 1, not 2)
    "preopen": ("sent", 1, 0),   # an open BEFORE the send is not counted (send-gated)
    "replyco": ("replied", 1, 0),# an inbound reply; the direction:in mail row is not counted as a send
    "bounceco": ("bounced", 1, 0),
    "wonco": ("won", 0, 0),      # a declared terminus stands
    "manualco": ("sent", 1, 0),  # a hand-recorded manual contact counts as a send
}

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

def sh(script):
    """Run a bash script, dropping to the postgres user when we are root."""
    if runas:
        return subprocess.run(["runuser", "-u", runas, "--", "bash", "-c", script],
                              capture_output=True, text=True)
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True)

try:
    if os.path.exists(work): shutil.rmtree(work, ignore_errors=True)
    os.makedirs(sock, exist_ok=True)
    if runas:
        shutil.chown(work, user=runas)
        shutil.chown(sock, user=runas)
    env = 'export PATH=%s:$PATH PGDATA=%s PGHOST=%s;' % (pgbin, data, sock)
    r = sh(env + ' initdb -U postgres -A trust >%s/init.log 2>&1' % work)
    if r.returncode != 0: skip("initdb failed: " + (r.stderr or r.stdout)[:200])
    r = sh(env + ' pg_ctl -D "$PGDATA" -o "-k $PGHOST -c listen_addresses=" -l %s/pg.log -w start' % work)
    if r.returncode != 0: skip("pg_ctl start failed: " + (r.stderr or r.stdout)[:200])
    try:
        # base tables + seed, the authenticated role the grant needs, then the REAL view file verbatim.
        with open(os.path.join(work, "seed.sql"), "w") as f: f.write(SEED)
        if runas: shutil.chown(os.path.join(work, "seed.sql"), user=runas)
        sh(env + ' psql -h "$PGHOST" -U postgres -v ON_ERROR_STOP=1 -q -f %s/seed.sql' % work)
        sh(env + ' psql -h "$PGHOST" -U postgres -q -c "create role authenticated;"')
        r = sh(env + ' psql -h "$PGHOST" -U postgres -v ON_ERROR_STOP=1 -f %s' % VIEW_SQL)
        ck("the view file applies cleanly (additive, security_invoker, grant authenticated)",
           r.returncode == 0, (r.stderr or r.stdout))

        q = 'psql -h "$PGHOST" -U postgres -t -A -F "|" -c "select slug, stage, sent_count, open_count from console_board order by slug;"'
        r = sh(env + " " + q)
        got = {}
        for line in (r.stdout or "").strip().splitlines():
            parts = line.split("|")
            if len(parts) == 4: got[parts[0]] = (parts[1], int(parts[2]), int(parts[3]))
        for slug, exp in EXPECT.items():
            ck("%s -> stage %s, sent %d, open %d" % (slug, exp[0], exp[1], exp[2]), got.get(slug) == exp, got.get(slug))

        # idle_days is null-safe without nullif: NULL for a card with no activity (no send/reply/open),
        # a real integer for a card with a send. Computed straight from last_activity_ts, never a string
        # coalesce and never a fabricated zero.
        r = sh(env + ' psql -h "$PGHOST" -U postgres -t -A -F "|" -c "select slug, coalesce(idle_days::text, \'NULL\') from console_board where slug in (\'ready\',\'sentco\') order by slug;"')
        idle = dict(line.split("|") for line in (r.stdout or "").strip().splitlines() if "|" in line)
        ck("idle_days is NULL for a no-activity card (ready), not a fabricated zero", idle.get("ready") == "NULL", idle)
        ck("idle_days is a real integer for a card with a send (sentco)", idle.get("sentco", "NULL").lstrip("-").isdigit(), idle)

        # determinism + one row per opp (acceptance #4)
        r = sh(env + ' psql -h "$PGHOST" -U postgres -t -A -c "select count(*), count(distinct slug) from console_board;"')
        ck("one row per opportunity (10 rows, 10 distinct slugs)", (r.stdout or "").strip() == "10|10", r.stdout)
        h = 'psql -h "$PGHOST" -U postgres -t -A -c "select md5(string_agg(slug||stage||sent_count::text||open_count::text||replied::text, chr(10) order by slug)) from console_board;"'
        r1 = sh(env + " " + h); r2 = sh(env + " " + h)
        ck("the view is deterministic (two runs return byte-identical rows)",
           (r1.stdout or "x").strip() == (r2.stdout or "y").strip() and bool((r1.stdout or "").strip()), (r1.stdout, r2.stdout))
    finally:
        sh(env + ' pg_ctl -D "$PGDATA" -w -m immediate stop >/dev/null 2>&1 || true')
finally:
    shutil.rmtree(work, ignore_errors=True)

print("\n%d failed" % len(fails))
for f in fails: print("  -", f)
sys.exit(1 if fails else 0)
