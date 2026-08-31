"""stage_gate: the approval gate on the DEPLOYED console_board view, proven against real Postgres.

A card must not reach 'ready' (engine stage 'live') on its own. This test applies the DEPLOYED view file,
docs/supabase-live-verified.sql (the one Thyab runs on Supabase; NOT the stale docs/supabase-board-view.sql that
board_view_sql_test.py still validates), to a throwaway Postgres cluster and proves:
  - a live page with NO approval reads 'draft' (Under review), never 'live' - the auto-jump is dead
  - the SAME card with approved_at set reads 'live' (ready) - reached ONLY by an explicit approval write
  - a prepared message (has_email) with no approval is 'draft', not 'live'
  - a legacy row (approved_at null) is 'draft' (the safe default; nothing auto-promotes)
  - a STORED stage='live' with no approval is 'draft' (a stale stored value can never produce ready)
  - a declared terminal (won) still stands; a sent card is unaffected by the gate
  - approved_at / approved_by are exposed on the board row (Axiom 5, the actor of the approval)

Skips cleanly (exit 0) where Postgres is unavailable, exactly like board_view_sql_test.py.
Run: python3 tools/stage_gate_test.py
"""
import os, shutil, subprocess, sys

ROOT = "/home/user/thrive-console"
VIEW_SQL = os.path.join(ROOT, "docs/supabase-live-verified.sql")   # the DEPLOYED view, with the gate

def skip(msg):
    print("SKIP stage_gate_test: " + msg)
    raise SystemExit(0)

pgbin = None
for cand in ("/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin", "/usr/lib/postgresql/14/bin"):
    if os.path.isdir(cand):
        pgbin = cand; break
if not pgbin or not shutil.which("psql"):
    skip("no local Postgres (psql / server binaries) available")

runas = None
if os.geteuid() == 0:
    import pwd
    try: pwd.getpwnam("postgres")
    except KeyError: skip("running as root and no 'postgres' user to drop to")
    runas = "postgres"

work = "/tmp/pgtest_stagegate"
sock = os.path.join(work, "sock")
data = os.path.join(work, "data")

# The real column shapes the client writes, plus the columns the deployed view reads (cycle, approved_at/by,
# live_verified_at). Every card below has ZERO sends unless it seeds a console_mail row, so branch 3 (the gate)
# governs it.
SEED = """
create table console_opps (slug text primary key, business text, stage text, archived boolean,
  outreach_subject text, outreach_text text, data jsonb, up bigint, cycle text,
  approved_at timestamptz, approved_by text);
create table console_mail (id text primary key, opp text, status text, to_addr text, subject text,
  ts timestamptz, actor text, data jsonb, up bigint, cycle text);
create table console_inbound (id text primary key, opp text, kind text, bounce text, ts text, data jsonb, up bigint);
create table console_hits (id text primary key, slug text, type text, ts text, self boolean, data jsonb, cycle text);
create table console_pages (slug text primary key, html text, live_verified_at timestamptz);

insert into console_opps(slug,business,stage,archived,outreach_subject,outreach_text,data,up,approved_at,approved_by) values
 ('up_unappr','Upload Unapproved','',false,'','','{}'::jsonb,1000, null, null),
 ('up_appr','Upload Approved','',false,'','','{}'::jsonb,1000, '2026-08-31T10:00:00Z', 'u_thyab'),
 ('email_unappr','Email Prepared','',false,'A subject','Some outreach text','{}'::jsonb,1000, null, null),
 ('legacy','Legacy Card','',false,'','','{}'::jsonb,1000, null, null),
 ('stored_live','Stored Live No Approval','live',false,'','','{}'::jsonb,1000, null, null),
 ('wonco','Won Co','won',false,'','','{}'::jsonb,1000, null, null),
 ('sentco','Sent Co','',false,'','','{}'::jsonb,1000, null, null);

-- live pages (verified) for the upload cards + legacy + stored_live, so the OLD derivation would have said 'live'
insert into console_pages(slug,html,live_verified_at) values
 ('up_unappr','<b>x</b>','2026-08-30T09:00:00Z'),
 ('up_appr','<b>x</b>','2026-08-30T09:00:00Z'),
 ('legacy','<b>x</b>','2026-08-30T09:00:00Z'),
 ('stored_live','<b>x</b>','2026-08-30T09:00:00Z');

-- one real send so sentco is post-send (the gate governs only no-send cards)
insert into console_mail(id,opp,status,ts,data) values ('m_sent','sentco','sent','2026-08-01T10:00:00Z','{}');
"""

EXPECT = {
    "up_unappr":   "draft",   # a live page, NO approval -> Under review, never auto-ready (the bug, fixed)
    "up_appr":     "live",    # the SAME card, approved_at set -> ready, reached only by the approval write
    "email_unappr":"draft",   # a prepared message with no approval is under review, not ready
    "legacy":      "draft",   # legacy row (approved_at null) -> under review (safe default, nothing auto-promotes)
    "stored_live": "draft",   # a STALE stored stage='live' with no approval -> draft (stored value never = ready)
    "wonco":       "won",     # a declared terminal still stands (branch 1)
    "sentco":      "sent",    # a sent card is unaffected by the gate
}

fails = []
def ck(n, c, d=None):
    print(("PASS " if c else "FAIL ") + n)
    if not c:
        fails.append(n)
        if d is not None: print("      " + str(d)[:300])

def sh(script):
    if runas:
        return subprocess.run(["runuser", "-u", runas, "--", "bash", "-c", script], capture_output=True, text=True)
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True)

try:
    if os.path.exists(work): shutil.rmtree(work, ignore_errors=True)
    os.makedirs(sock, exist_ok=True)
    if runas:
        shutil.chown(work, user=runas); shutil.chown(sock, user=runas)
    env = 'export PATH=%s:$PATH PGDATA=%s PGHOST=%s;' % (pgbin, data, sock)
    r = sh(env + ' initdb -U postgres -A trust >%s/init.log 2>&1' % work)
    if r.returncode != 0: skip("initdb failed: " + (r.stderr or r.stdout)[:200])
    r = sh(env + ' pg_ctl -D "$PGDATA" -o "-k $PGHOST -c listen_addresses=" -l %s/pg.log -w start' % work)
    if r.returncode != 0: skip("pg_ctl start failed: " + (r.stderr or r.stdout)[:200])
    try:
        with open(os.path.join(work, "seed.sql"), "w") as f: f.write(SEED)
        if runas: shutil.chown(os.path.join(work, "seed.sql"), user=runas)
        sh(env + ' psql -h "$PGHOST" -U postgres -v ON_ERROR_STOP=1 -q -f %s/seed.sql' % work)
        sh(env + ' psql -h "$PGHOST" -U postgres -q -c "create role authenticated;"')
        r = sh(env + ' psql -h "$PGHOST" -U postgres -v ON_ERROR_STOP=1 -f %s' % VIEW_SQL)
        ck("the deployed view file applies cleanly (drop+create, security_invoker, grant authenticated)",
           r.returncode == 0, (r.stderr or r.stdout))

        q = 'psql -h "$PGHOST" -U postgres -t -A -F "|" -c "select slug, stage, coalesce(approved_by,\'\') from console_board order by slug;"'
        r = sh(env + " " + q)
        got = {}
        for line in (r.stdout or "").strip().splitlines():
            p = line.split("|")
            if len(p) == 3: got[p[0]] = (p[1], p[2])
        for slug, exp in EXPECT.items():
            g = got.get(slug)
            ck("%s -> stage %s" % (slug, exp), g is not None and g[0] == exp, g)
        # Axiom 5: the approver's uid is exposed on the approved row.
        ck("approved_by is exposed on the board row (the approval's actor)",
           got.get("up_appr") == ("live", "u_thyab"), got.get("up_appr"))
        # and an unapproved card exposes an empty approver.
        ck("an unapproved card exposes no approver", got.get("up_unappr") == ("draft", ""), got.get("up_unappr"))
    finally:
        sh(env + ' pg_ctl -D "$PGDATA" -m immediate -w stop >/dev/null 2>&1')
finally:
    shutil.rmtree(work, ignore_errors=True)

print("")
if fails:
    print("%d failed" % len(fails)); sys.exit(1)
print("0 failed")
