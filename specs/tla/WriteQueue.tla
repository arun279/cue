---------------------------- MODULE WriteQueue ----------------------------
(***************************************************************************)
(* A model of src/core/domain/write-queue/queue.ts (class WriteQueue).     *)
(*                                                                         *)
(* JavaScript is single threaded, so each action below is one synchronous  *)
(* segment of the real code between two awaits. Everything an await waits  *)
(* on (a device write, a Trakt request, an app kill) is an action of the   *)
(* environment, and may interleave with any other segment.                 *)
(*                                                                         *)
(*   enqueue(op)           -> Enqueue(o)   (twin / alias / cancel rules)    *)
(*   save() / this.saved   -> SaveStart, SaveOk, SaveFail                   *)
(*   flush() / drain()     -> Flush, DrainKept, Send*                       *)
(*   new WriteQueue(stored) after a relaunch -> Crash                       *)
(*                                                                         *)
(* Check with TLC (tla2tools.jar from github.com/tlaplus/tlaplus releases): *)
(*   java -cp tla2tools.jar tlc2.TLC -deadlock -config <cfg> MC_WriteQueue *)
(*   WriteQueue_nofaults.cfg  every invariant and Drains hold               *)
(*   WriteQueue.cfg           CancelledNeverApplied is violated (9 states)  *)
(*   WriteQueue_savefail.cfg  DiskSettles is violated with no app kill      *)
(*   WriteQueue_fix.cfg       every invariant and Drains hold               *)
(* TLC stops at the first violated invariant; list one at a time to see    *)
(* the others (FailedUnsentNeverApplied, FifoPerItem) fail too.            *)
(*                                                                         *)
(* save() chains on this.saved and takes its snapshot when it STARTS        *)
(* (`this.saved.then(() => deps.save([...this.snapshot(), ...]))`), so a   *)
(* save requested earlier can write a write that a later change removes.   *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS
  Ops,              \* op ids the UI may submit, each at most once
  KeyOf,            \* [Ops -> item key]                QueuedOp.itemKey
  ToOf,             \* [Ops -> {"present","absent"}]    QueuedOp.toState
  TakeBack,         \* ops that carry `undoes`, which enqueue never cancels
  SaveCanFail,      \* whether deps.save (an expo-sqlite write) may reject
  MaxCrashes,       \* how many times the app may be killed and relaunched
  RetryFailedSaves, \* FALSE: the code today. TRUE: the proposed fix (retry a rejected save)
  NULL

VARIABLES
  pending,       \* in memory: Seq of [id, sent]               this.pending
  owner,         \* in memory: op -> delivery it settles with  this.deliveries
  outcome,       \* in memory: delivery -> how it ended        Delivery.outcome
  disk,          \* on device: op ids as last written           OP_LOG_KEY
  saveWait,      \* saves chained on this.saved, not started; tag = op enqueue() saved, or NULL
  saveRun,       \* NULL or [tag, snap]: the device write in progress
  dpc,           \* drain(): "idle" | "kept" (awaiting this.saved) | "send" (awaiting Trakt)
  dnext,         \* the delivery the drain is on
  dwait,         \* chained saves `await this.kept(next)` still waits for
  \* ---- ghost (history) variables, used only by the properties ----
  submitted, subOrder,   \* ops the UI has submitted, in order
  applied, applyOrder,   \* ops Trakt has applied; applyOrder keeps first applications
  everCancelled,         \* ops the UI was told ended "cancelled"
  failedUnsent,          \* ops the UI was told "failed" because the device could not keep them
  crashes

vars == <<pending, owner, outcome, disk, saveWait, saveRun, dpc, dnext, dwait,
          submitted, subOrder, applied, applyOrder, everCancelled, failedUnsent, crashes>>

-----------------------------------------------------------------------------
Range(s)      == {s[i] : i \in DOMAIN s}
Ids(s)        == [i \in 1..Len(s) |-> s[i].id]
PendingIds    == Range(Ids(pending))
Without(o)    == SelectSeq(pending, LAMBDA r : r.id # o)
Max(S)        == CHOOSE m \in S : \A n \in S : n <= m
IndexIn(s, x) == CHOOSE i \in DOMAIN s : s[i] = x
Outstanding(w, r) == Len(w) + (IF r = NULL THEN 0 ELSE 1)
SaveSettled   == IF dwait > 0 THEN dwait - 1 ELSE 0   \* saves settle in chain order

\* After finish(), the for-loop reads pending[0] again and awaits kept() on it.
NextIteration(p, waitFor) ==
  IF p = <<>>
  THEN /\ dpc' = "idle" /\ dnext' = NULL /\ dwait' = 0
  ELSE /\ dpc' = "kept" /\ dnext' = Head(p).id /\ dwait' = waitFor

-----------------------------------------------------------------------------
Init ==
  /\ pending = <<>>
  /\ owner = [o \in Ops |-> NULL]
  /\ outcome = [o \in Ops |-> "none"]
  /\ disk = <<>>
  /\ saveWait = <<>> /\ saveRun = NULL
  /\ dpc = "idle" /\ dnext = NULL /\ dwait = 0
  /\ submitted = {} /\ subOrder = <<>>
  /\ applied = {} /\ applyOrder = <<>>
  /\ everCancelled = {} /\ failedUnsent = {}
  /\ crashes = 0

(* enqueue(op): weighed against the LAST pending write for the same item.  *)
Enqueue(o) ==
  /\ o \notin submitted
  /\ submitted' = submitted \cup {o}
  /\ subOrder' = Append(subOrder, o)
  /\ LET T  == {i \in DOMAIN pending : KeyOf[pending[i].id] = KeyOf[o]}
         ti == IF T = {} THEN 0 ELSE Max(T)
         tw == IF ti = 0 THEN [id |-> NULL, sent |-> TRUE] ELSE pending[ti]
     IN  IF ti = 0 \/ tw.sent \/ tw.id \in TakeBack
         THEN \* no unsent twin: queue it and save; a rejected save ends it "failed"
              /\ pending'  = Append(pending, [id |-> o, sent |-> FALSE])
              /\ owner'    = [owner EXCEPT ![o] = o]
              /\ saveWait' = Append(saveWait, o)
              /\ UNCHANGED <<outcome, everCancelled>>
         ELSE IF ToOf[tw.id] = ToOf[o]
         THEN \* a repeat ends as the unsent twin ends
              /\ owner' = [owner EXCEPT ![o] = tw.id]
              /\ UNCHANGED <<pending, saveWait, outcome, everCancelled>>
         ELSE \* an opposite write cancels the unsent twin and itself: two finish() calls
              /\ pending'  = Without(tw.id)
              /\ owner'    = [owner EXCEPT ![o] = o]
              /\ outcome'  = [outcome EXCEPT ![tw.id] = "cancelled", ![o] = "cancelled"]
              /\ everCancelled' = everCancelled \cup
                                  {x \in Ops : owner'[x] \in {tw.id, o}}
              /\ saveWait' = saveWait \o <<NULL, NULL>>
  /\ UNCHANGED <<disk, saveRun, dpc, dnext, dwait, applied, applyOrder,
                 failedUnsent, crashes>>

(* The next chained save starts: it snapshots the queue as it stands now.   *)
SaveStart ==
  /\ saveRun = NULL /\ saveWait # <<>>
  /\ saveRun'  = [tag |-> Head(saveWait), snap |-> Ids(pending)]
  /\ saveWait' = Tail(saveWait)
  /\ UNCHANGED <<pending, owner, outcome, disk, dpc, dnext, dwait, submitted,
                 subOrder, applied, applyOrder, everCancelled, failedUnsent, crashes>>

SaveOk ==
  /\ saveRun # NULL
  /\ disk' = saveRun.snap
  /\ saveRun' = NULL
  /\ dwait' = SaveSettled
  /\ UNCHANGED <<pending, owner, outcome, saveWait, dpc, dnext, submitted, subOrder,
                 applied, applyOrder, everCancelled, failedUnsent, crashes>>

(* The device write rejects. Only the save enqueue() made has a handler: it *)
(* fails that write if it is still pending. Every other save is `void`ed,   *)
(* unless RetryFailedSaves models the fix.                                  *)
SaveFail ==
  /\ SaveCanFail /\ saveRun # NULL
  /\ saveRun' = NULL
  /\ dwait' = SaveSettled
  /\ LET o       == saveRun.tag
         failsOp == o # NULL /\ o \in PendingIds
     IN  /\ IF failsOp
            THEN /\ pending' = Without(o)
                 /\ outcome' = [outcome EXCEPT ![o] = "failed"]
                 /\ failedUnsent' = failedUnsent \cup {x \in Ops : owner[x] = o}
            ELSE UNCHANGED <<pending, outcome, failedUnsent>>
         /\ saveWait' = IF failsOp \/ RetryFailedSaves
                        THEN Append(saveWait, NULL) ELSE saveWait
  /\ UNCHANGED <<owner, disk, dpc, dnext, submitted, subOrder, applied,
                 applyOrder, everCancelled, crashes>>

(* flush() with no drain running: the loop's first `await this.kept(next)`. *)
Flush ==
  /\ dpc = "idle" /\ pending # <<>>
  /\ dpc' = "kept" /\ dnext' = Head(pending).id
  /\ dwait' = Outstanding(saveWait, saveRun)
  /\ UNCHANGED <<pending, owner, outcome, disk, saveWait, saveRun, submitted,
                 subOrder, applied, applyOrder, everCancelled, failedUnsent, crashes>>

(* kept() resolved: still first in line? then `next.sent = true` and send.  *)
DrainKept ==
  /\ dpc = "kept" /\ dwait = 0
  /\ IF pending # <<>> /\ Head(pending).id = dnext
     THEN /\ pending' = [pending EXCEPT ![1].sent = TRUE]
          /\ dpc' = "send"
          /\ UNCHANGED <<dnext, dwait>>
     ELSE /\ UNCHANGED pending
          /\ NextIteration(pending, Outstanding(saveWait, saveRun))
  /\ UNCHANGED <<owner, outcome, disk, saveWait, saveRun, submitted, subOrder,
                 applied, applyOrder, everCancelled, failedUnsent, crashes>>

Apply(o) == /\ applied' = applied \cup {o}
            /\ applyOrder' = IF o \in applied THEN applyOrder ELSE Append(applyOrder, o)

Finish(o, out) ==
  /\ pending'  = Without(o)
  /\ outcome'  = [outcome EXCEPT ![o] = out]
  /\ saveWait' = Append(saveWait, NULL)
  /\ NextIteration(Without(o), Outstanding(Append(saveWait, NULL), saveRun))

(* Trakt applies the write and its 2xx answer arrives.                     *)
SendAnswered ==
  /\ dpc = "send"
  /\ Apply(dnext)
  /\ Finish(dnext, "done")
  /\ UNCHANGED <<owner, disk, saveRun, submitted, subOrder, everCancelled,
                 failedUnsent, crashes>>

(* Trakt applies it but the answer is lost: dispatch throws, deliver()      *)
(* returns null and the write stays first in line.                          *)
SendLost ==
  /\ dpc = "send"
  /\ Apply(dnext)
  /\ dpc' = "idle" /\ dnext' = NULL /\ dwait' = 0
  /\ UNCHANGED <<pending, owner, outcome, disk, saveWait, saveRun, submitted,
                 subOrder, everCancelled, failedUnsent, crashes>>

(* Offline, or five 5xx/429 answers in this flush: kept for a later flush.  *)
SendNotApplied ==
  /\ dpc = "send"
  /\ dpc' = "idle" /\ dnext' = NULL /\ dwait' = 0
  /\ UNCHANGED <<pending, owner, outcome, disk, saveWait, saveRun, submitted,
                 subOrder, applied, applyOrder, everCancelled, failedUnsent, crashes>>

(* Trakt refuses it (4xx): not applied, ends "failed", the next is sent.    *)
SendRefused ==
  /\ dpc = "send"
  /\ Finish(dnext, "failed")
  /\ UNCHANGED <<owner, disk, saveRun, submitted, subOrder, applied, applyOrder,
                 everCancelled, failedUnsent, crashes>>

(* The OS kills the app. On relaunch createCueRuntime builds a new          *)
(* WriteQueue from OP_LOG_KEY, treating every stored write as possibly sent. *)
Crash ==
  /\ crashes < MaxCrashes
  /\ crashes' = crashes + 1
  /\ pending' = [i \in 1..Len(disk) |-> [id |-> disk[i], sent |-> TRUE]]
  /\ owner'   = [o \in Ops |-> IF o \in Range(disk) THEN o ELSE NULL]
  /\ outcome' = [o \in Ops |-> "none"]
  /\ saveWait' = <<>> /\ saveRun' = NULL
  /\ dpc' = "idle" /\ dnext' = NULL /\ dwait' = 0
  /\ UNCHANGED <<disk, submitted, subOrder, applied, applyOrder, everCancelled,
                 failedUnsent>>

Next ==
  \/ \E o \in Ops : Enqueue(o)
  \/ SaveStart \/ SaveOk \/ SaveFail
  \/ Flush \/ DrainKept
  \/ SendAnswered \/ SendLost \/ SendNotApplied \/ SendRefused
  \/ Crash

Fairness ==
  /\ WF_vars(SaveStart) /\ WF_vars(Flush) /\ WF_vars(DrainKept)
  /\ SF_vars(SaveOk) /\ SF_vars(SendAnswered)

Spec == Init /\ [][Next]_vars /\ Fairness

-----------------------------------------------------------------------------
TypeOK ==
  /\ \A i \in DOMAIN pending : pending[i].id \in Ops /\ pending[i].sent \in BOOLEAN
  /\ dpc \in {"idle", "kept", "send"}
  /\ Range(disk) \subseteq Ops
  /\ applied \subseteq submitted

(* A write the UI was told ended "cancelled" never reaches Trakt.           *)
CancelledNeverApplied == everCancelled \cap applied = {}

(* A write the UI was told "failed" because the device couldn't keep it     *)
(* never reaches Trakt.                                                     *)
FailedUnsentNeverApplied == failedUnsent \cap applied = {}

(* "no write is sent before the device has kept it"                        *)
SentOnlyIfKept == dpc = "send" => dnext \in Range(disk)

(* Writes to one item first reach Trakt in the order they were made.       *)
FifoPerItem ==
  \A i, j \in DOMAIN applyOrder :
     (i < j /\ KeyOf[applyOrder[i]] = KeyOf[applyOrder[j]])
        => IndexIn(subOrder, applyOrder[i]) <= IndexIn(subOrder, applyOrder[j])

(* Once no save is outstanding, the op log on the device is exactly the     *)
(* queue in memory: no ended write is left behind for a relaunch to send.   *)
DiskSettles == (saveRun = NULL /\ saveWait = <<>>) => disk = Ids(pending)

(* Liveness: with Trakt and the device eventually answering, the queue      *)
(* empties.                                                                 *)
Drains == <>[](pending = <<>> /\ dpc = "idle")
=============================================================================
