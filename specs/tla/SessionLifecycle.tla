-------------------------- MODULE SessionLifecycle --------------------------
(***************************************************************************)
(* The account session as three cooperating state machines:                *)
(*                                                                         *)
(*  auth store   phase onboarding | connected, `session` counter           *)
(*               (src/core/auth/create-auth-store.ts)                      *)
(*  runtime      none | live | ended (its AbortSignal), `ending` promise   *)
(*               (src/core/runtime/create-runtime.ts: end, endLocalSession)*)
(*  sign-out     SignOut.signOut(): endLocalSession() then disconnect()    *)
(*               (src/screens/account/SignOut.tsx)                         *)
(*  dead token   authorized-fetch endSession -> end().then(deps.endSession)*)
(*                                                                         *)
(* Continuations that only chain microtasks on one promise run in the same *)
(* step as the promise settling, so the model never separates what the     *)
(* event loop cannot.                                                       *)
(*                                                                         *)
(* Check with TLC:                                                         *)
(*   java -cp tla2tools.jar tlc2.TLC -deadlock -config <cfg> SessionLifecycle *)
(*   SessionLifecycle_nofaults.cfg  everything holds                        *)
(*   SessionLifecycle.cfg           NoZombieAtRest is violated (5 states)   *)
(*   SessionLifecycle_fix.cfg       everything holds                        *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS ClearCanFail,       \* clearAccount() may reject (kv.remove, reminders.cancelAll, caches)
          TokenReadCanFail,   \* revokeStoredToken(): tokenStore.read() may reject
          MaxSignIns,
          FixRestoreOnFail    \* FALSE: the code today. TRUE: the proposed fix

VARIABLES phase, session, token, rt, rtSession, ending, so, soStarted, soError,
          dt, droppedAtRest, wrongEnd, signIns

vars == <<phase, session, token, rt, rtSession, ending, so, soStarted, soError,
          dt, droppedAtRest, wrongEnd, signIns>>

Init ==
  /\ phase = "connected" /\ session = 0 /\ token = "stored"
  /\ rt = "none" /\ rtSession = 0 /\ ending = "none"
  /\ so = "idle" /\ soStarted = 0 /\ soError = FALSE
  /\ dt = "idle" /\ droppedAtRest = FALSE /\ wrongEnd = FALSE /\ signIns = 0

(* endSessionFrom(started): ends the session it started in, never a later one. *)
EndSessionFrom(started) ==
  IF started = session
  THEN /\ session' = session + 1 /\ phase' = "onboarding" /\ token' = "none"
       /\ rt' = "none"                     \* Gate unmounts RuntimeBoot
  ELSE UNCHANGED <<session, phase, token, rt>>

(* RuntimeBoot / useRuntimeBoot: a connected phase with a token builds one. *)
Boot ==
  /\ phase = "connected" /\ rt = "none" /\ token = "stored"
  /\ rt' = "live" /\ rtSession' = session /\ ending' = "none"
  /\ UNCHANGED <<phase, session, token, so, soStarted, soError, dt, droppedAtRest,
                 wrongEnd, signIns>>

AtRest == so = "idle" /\ dt = "idle"

(* A mark, hide or watchlist change from any screen. On an ended runtime    *)
(* kv.write is skipped by whileLive (so save() "keeps" it), and forScreens'  *)
(* quiet() never settles the submit: the optimistic change is shown, and     *)
(* the write is neither kept on the device nor sent.                         *)
UserWrite ==
  /\ phase = "connected" /\ rt = "ended" /\ AtRest
  /\ droppedAtRest' = TRUE
  /\ UNCHANGED <<phase, session, token, rt, rtSession, ending, so, soStarted, soError,
                 dt, wrongEnd, signIns>>

StartEnding == ending' = IF ending = "none" THEN "running" ELSE ending

(* The user confirms "Sign out".                                            *)
SignOutPress ==
  /\ so = "idle" /\ phase = "connected" /\ rt # "none"
  /\ soError' = FALSE
  /\ IF rt = "live"
     THEN so' = "flushing" /\ UNCHANGED <<rt, ending>>      \* await queue.flush()
     ELSE so' = "ending" /\ StartEnding /\ UNCHANGED rt     \* signal already aborted: end()
  /\ UNCHANGED <<phase, session, token, rtSession, soStarted, dt, droppedAtRest,
                 wrongEnd, signIns>>

(* queue.flush() returned.                                                  *)
SignOutFlushed ==
  /\ so = "flushing"
  /\ \/ /\ rt = "live"                         \* writes still queued: PendingWritesError
        /\ so' = "idle" /\ soError' = TRUE
        /\ UNCHANGED <<rt, ending>>
     \/ /\ so' = "ending" /\ rt' = "ended"     \* end(): session.abort(), then clearAccount
        /\ StartEnding /\ UNCHANGED soError
  /\ UNCHANGED <<phase, session, token, rtSession, soStarted, dt, droppedAtRest,
                 wrongEnd, signIns>>

(* Trakt says the refresh token is dead: end().catch(() => {}).then(endSession). *)
DeadToken ==
  /\ rt = "live" /\ dt = "idle"
  /\ rt' = "ended" /\ StartEnding /\ dt' = "waiting"
  /\ UNCHANGED <<phase, session, token, rtSession, so, soStarted, soError, droppedAtRest,
                 wrongEnd, signIns>>

(* The dead-token continuation: deps.endSession = () => endSessionFrom(session). *)
DeadTokenThen ==
  /\ wrongEnd' = (wrongEnd \/ session # rtSession)
  /\ EndSessionFrom(session)

(* clearAccount() resolves: both continuations run before any further I/O.  *)
ClearOk ==
  /\ ending = "running"
  /\ ending' = "ok"
  /\ IF dt = "waiting"
     THEN \* endSession runs first (it chained on `ending` first). It clears the
          \* token, so sign-out's disconnect() then reads null from the token store's
          \* cached promise, revokes nothing and ends the new session number at once:
          \* no I/O separates the two, so no sign-in can come between them.
          /\ dt' = "idle"
          /\ wrongEnd' = (wrongEnd \/ session # rtSession)
          /\ phase' = "onboarding" /\ token' = "none" /\ rt' = "none"
          /\ session' = IF so = "ending" THEN session + 2 ELSE session + 1
          /\ IF so = "ending" THEN so' = "idle" /\ soStarted' = session + 1
             ELSE UNCHANGED <<so, soStarted>>
     ELSE /\ UNCHANGED <<phase, session, token, rt, wrongEnd, dt>>
          /\ IF so = "ending" THEN so' = "revoking" /\ soStarted' = session
             ELSE UNCHANGED <<so, soStarted>>
  /\ UNCHANGED <<rtSession, soError, droppedAtRest, signIns>>

(* clearAccount() rejects: `ending = null; throw error`. The session signal *)
(* stays aborted. SignOut shows "Couldn't finish signing out".              *)
ClearFail ==
  /\ ClearCanFail /\ ending = "running"
  /\ ending' = "none"
  /\ IF dt = "waiting"
     THEN /\ DeadTokenThen /\ dt' = "idle"                \* .catch(() => {}) then endSession
          /\ IF so = "ending" THEN so' = "idle" /\ soError' = TRUE
             ELSE UNCHANGED <<so, soError>>
     ELSE /\ dt' = dt /\ UNCHANGED wrongEnd
          /\ so' = IF so = "ending" THEN "idle" ELSE so
          /\ soError' = (soError \/ so = "ending")
          /\ IF FixRestoreOnFail /\ so = "ending"
             THEN rt' = "none" /\ UNCHANGED <<phase, session, token>>  \* rebuild the runtime
             ELSE UNCHANGED <<phase, session, token, rt>>
  /\ UNCHANGED <<rtSession, soStarted, droppedAtRest, signIns>>

(* end() returned an `ending` that had already resolved: go on to disconnect(). *)
SignOutEnded ==
  /\ so = "ending" /\ ending = "ok"
  /\ so' = "revoking" /\ soStarted' = session
  /\ UNCHANGED <<phase, session, token, rt, rtSession, ending, soError, dt, droppedAtRest,
                 wrongEnd, signIns>>

(* disconnect(): revokeStoredToken() settles.                               *)
RevokeDone ==
  /\ so = "revoking"
  /\ EndSessionFrom(soStarted)
  /\ so' = "idle"
  /\ UNCHANGED <<rtSession, ending, soStarted, soError, dt, droppedAtRest, wrongEnd, signIns>>

RevokeFail ==
  /\ TokenReadCanFail /\ so = "revoking"
  /\ so' = "idle" /\ soError' = TRUE                       \* disconnecting = null; throw
  /\ IF FixRestoreOnFail THEN rt' = "none" ELSE UNCHANGED rt
  /\ UNCHANGED <<phase, session, token, rtSession, ending, soStarted, dt, droppedAtRest,
                 wrongEnd, signIns>>

(* Onboarding: connectWithDeviceCode -> connect(): clearAccount, write token.  *)
\* Assumption: once its session's signal aborts, the last sign-out's flush and
\* teardown settle in milliseconds (sleep wakes, withDeadline throws), long before
\* a device-code sign-in can finish, so no sign-in overlaps them.
SignIn ==
  /\ phase = "onboarding" /\ signIns < MaxSignIns /\ so = "idle" /\ dt = "idle"
  /\ phase' = "connected" /\ token' = "stored" /\ signIns' = signIns + 1
  /\ UNCHANGED <<session, rt, rtSession, ending, so, soStarted, soError, dt,
                 droppedAtRest, wrongEnd>>

Next == Boot \/ UserWrite \/ SignOutPress \/ SignOutFlushed \/ DeadToken
        \/ ClearOk \/ ClearFail \/ SignOutEnded \/ RevokeDone \/ RevokeFail \/ SignIn

\* The app's own steps are fair, and device or network failures are transient
\* (strong fairness on the successful outcome). The user's steps (signing out
\* again, signing in) are not assumed to happen.
Spec == Init /\ [][Next]_vars
        /\ WF_vars(Boot) /\ WF_vars(SignOutFlushed) /\ WF_vars(SignOutEnded)
        /\ WF_vars(ClearOk \/ ClearFail) /\ SF_vars(ClearOk)
        /\ WF_vars(RevokeDone \/ RevokeFail) /\ SF_vars(RevokeDone)

-----------------------------------------------------------------------------
Zombie == phase = "connected" /\ rt = "ended"

(* An ended runtime under a connected phase exists only while a teardown    *)
(* that will leave it is still running.                                     *)
NoZombieAtRest == Zombie => ~AtRest

(* No change the user makes while the app looks signed in is silently lost. *)
NoWriteDroppedAtRest == ~droppedAtRest

(* endSession only ever ends the session its runtime belonged to.           *)
EndsOwnSession == ~wrongEnd

(* Without the user's help, an ended runtime under a connected phase leaves *)
(* that state: the app either signs out or comes back live.                 *)
ZombieResolves == Zombie ~> ~Zombie
=============================================================================
