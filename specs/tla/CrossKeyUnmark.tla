--------------------------- MODULE CrossKeyUnmark ---------------------------
(***************************************************************************)
(* One episode E of one show, the write queue (FIFO, one write in flight), *)
(* and the Show Detail actions that touch E (src/core/hooks/useMarkSeason) *)
(*                                                                         *)
(*   MarkSeason      markSeason / markUpToHere  -> one bulk add, item key  *)
(*                   "show:X:bulk:<hash>"  (buildBulkMarkOps)              *)
(*   RewatchSeason   rewatchSeason              -> additive bulk add       *)
(*   MarkEpisode     toggleEpisode, unwatched   -> add, key "episode:E"    *)
(*   Unmark*         toggleEpisode, watched     -> unmarkEpisode():        *)
(*                   pendingMark("episode:E") ? cancel / take back         *)
(*                                            : read history, then remove  *)
(*   RemoveAll*      removeAllPlays             -> read history, remove    *)
(*                                                                         *)
(* `want` is what the user last asked E to be. Once nothing is queued or   *)
(* being read, Trakt should hold a play of E exactly when `want` is TRUE.  *)
(*                                                                         *)
(* Check with TLC:                                                         *)
(*   java -cp tla2tools.jar tlc2.TLC -deadlock -config <cfg> CrossKeyUnmark *)
(*   CrossKeyUnmark.cfg        IntentHonored is violated (6 states)         *)
(*   CrossKeyUnmark_prior.cfg  violated, deleting the earlier play (8)      *)
(*   CrossKeyUnmark_fix.cfg    IntentHonored holds                          *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS
  PriorPlay,          \* E already has one play on Trakt before the run
  AllowRewatch,       \* include "Rewatch season"
  MaxUnmarks,         \* how many times the user may toggle E off
  FixWaitForWrites    \* FALSE: the code today. TRUE: the proposed fix

VARIABLES
  trakt,    \* plays of E on Trakt (tags)
  at,       \* tag -> when it was marked, to find the newest play
  queue,    \* Seq of [key, kind, play, plays, sent]
  ui,       \* Show Detail shows E watched
  want,     \* ghost: the user's last intent for E
  upc,      \* unmarkEpisode():  "idle" | "reading" (awaiting loadEpisodePlays)
  rpc,      \* removeAllPlays(): "idle" | "reading"
  stamp,    \* writesBegun() when the in-progress read-then-remove began
  began,    \* writesBegun(): writes begun so far
  used, unmarks, clock

vars == <<trakt, at, queue, ui, want, upc, rpc, stamp, began, used, unmarks, clock>>

Max(S) == CHOOSE m \in S : \A n \in S : n <= m
Tags   == {"p0", "pS", "pR", "pE"}

(* pendingMark(runtime, "episode:E"): the latest queued write for that key, *)
(* when it is an add. Bulk adds carry another key, so they never count.     *)
PendingMarkIdx ==
  LET T == {i \in DOMAIN queue : queue[i].key = "episode:E"}
  IN  IF T = {} THEN 0
      ELSE IF queue[Max(T)].kind = "add" THEN Max(T) ELSE 0

PendingAdd == \E i \in DOMAIN queue : queue[i].kind = "add"
Locked     == upc # "idle" \/ rpc # "idle"      \* episodeWriteLock(show, s, e)

AddOp(key, tag) == [key |-> key, kind |-> "add", play |-> tag, plays |-> {}, sent |-> FALSE]
RemoveOp(S)     == [key |-> "history-plays", kind |-> "remove", play |-> "none", plays |-> S, sent |-> FALSE]
TakeBackOp(tag) == [key |-> "episode:E", kind |-> "remove", play |-> "none", plays |-> {tag}, sent |-> FALSE]

Mark(key, tag) ==
  /\ queue' = Append(queue, AddOp(key, tag))
  /\ at' = [at EXCEPT ![tag] = clock] /\ clock' = clock + 1
  /\ began' = began + 1
  /\ ui' = TRUE /\ want' = TRUE

-----------------------------------------------------------------------------
Init ==
  /\ trakt = IF PriorPlay THEN {"p0"} ELSE {}
  /\ at = [t \in Tags |-> 0]
  /\ queue = <<>>
  /\ ui = PriorPlay /\ want = PriorPlay
  /\ upc = "idle" /\ rpc = "idle" /\ stamp = 0 /\ began = 0
  /\ used = {} /\ unmarks = 0 /\ clock = 1

(* Season mark: built from the season view's unwatched aired episodes.      *)
MarkSeason ==
  /\ "season" \notin used /\ ~ui
  /\ used' = used \cup {"season"}
  /\ Mark("show:X:bulk", "pS")
  /\ UNCHANGED <<trakt, upc, rpc, stamp, unmarks>>

RewatchSeason ==
  /\ AllowRewatch /\ "rewatch" \notin used
  /\ used' = used \cup {"rewatch"}
  /\ Mark("show:X:bulk:add", "pR")
  /\ UNCHANGED <<trakt, upc, rpc, stamp, unmarks>>

(* markEpisode(): skipped while hasPendingMark("episode:E").               *)
MarkEpisode ==
  /\ "mark" \notin used /\ ~ui /\ ~Locked /\ PendingMarkIdx = 0
  /\ used' = used \cup {"mark"}
  /\ Mark("episode:E", "pE")
  /\ UNCHANGED <<trakt, upc, rpc, stamp, unmarks>>

(* unmarkEpisode(), synchronous part.                                       *)
UnmarkStart ==
  /\ ui /\ ~Locked /\ unmarks < MaxUnmarks
  /\ unmarks' = unmarks + 1
  /\ ui' = FALSE /\ want' = FALSE
  /\ LET i == PendingMarkIdx
         \* the fix: another queued add (another item key) also gives E a play
         others == FixWaitForWrites /\
                   \E j \in DOMAIN queue : queue[j].kind = "add" /\ queue[j].key # "episode:E"
     IN
     IF i # 0 /\ ~others
     THEN \* submitQueuedEpisodeUnmark: cancel an unsent mark, else take it back
          /\ queue' = IF ~queue[i].sent
                      THEN [j \in 1..(Len(queue) - 1) |->
                              IF j < i THEN queue[j] ELSE queue[j + 1]]
                      ELSE Append(queue, TakeBackOp(queue[i].play))
          /\ began' = began + 1
          /\ UNCHANGED <<upc, stamp>>
     ELSE \* submitLiveEpisodeUnmark: await resolveEpisodeUnmark (reads Trakt)
          /\ upc' = "reading" /\ stamp' = began
          /\ UNCHANGED <<queue, began>>
  /\ UNCHANGED <<trakt, at, rpc, used, clock>>

\* The fix: read only once no write naming the show is still queued, and drop
\* the plan if a newer write to the show began meanwhile (latestWrite > pressed).
ReadAllowed  == ~FixWaitForWrites \/ ~PendingAdd
PlanIsStale  == FixWaitForWrites /\ began > stamp
Newest(S)    == CHOOSE t \in S : \A u \in S : at[u] <= at[t]

(* resolveEpisodeUnmark answers with Trakt's plays of E as they are now.    *)
UnmarkRead ==
  /\ upc = "reading" /\ ReadAllowed
  /\ upc' = "idle"
  /\ IF PlanIsStale \/ trakt = {}
     THEN UNCHANGED <<queue, ui, want, began>>                  \* kind "none"
     ELSE IF Cardinality(trakt) = 1
     THEN /\ queue' = Append(queue, RemoveOp(trakt))              \* kind "remove"
          /\ began' = began + 1
          /\ UNCHANGED <<ui, want>>
     ELSE /\ queue' = Append(queue, RemoveOp({Newest(trakt)}))    \* kind "rewatch"
          /\ began' = began + 1
          /\ ui' = TRUE /\ want' = TRUE      \* "Removed 1 play · n remain"
  /\ UNCHANGED <<trakt, at, rpc, stamp, used, unmarks, clock>>

(* removeAllPlays(): await loadEpisodePlays, then remove what it returned.  *)
RemoveAllStart ==
  /\ "removeAll" \notin used /\ ~Locked
  /\ used' = used \cup {"removeAll"}
  /\ rpc' = "reading" /\ stamp' = began
  /\ want' = FALSE
  /\ UNCHANGED <<trakt, at, queue, ui, upc, began, unmarks, clock>>

RemoveAllRead ==
  /\ rpc = "reading" /\ ReadAllowed
  /\ rpc' = "idle"
  /\ IF PlanIsStale \/ trakt = {}
     THEN UNCHANGED <<queue, ui, began>>
     ELSE /\ queue' = Append(queue, RemoveOp(trakt))
          /\ ui' = FALSE /\ began' = began + 1
  /\ UNCHANGED <<trakt, at, want, upc, stamp, used, unmarks, clock>>

(* The queue: the head is sent, then Trakt applies it. A take-back removes *)
(* the play its add made (ownPlays), read once the add has gone.            *)
Send ==
  /\ queue # <<>> /\ ~Head(queue).sent
  /\ queue' = [queue EXCEPT ![1].sent = TRUE]
  /\ UNCHANGED <<trakt, at, ui, want, upc, rpc, stamp, began, used, unmarks, clock>>

Deliver ==
  /\ queue # <<>> /\ Head(queue).sent
  /\ LET op == Head(queue) IN
     trakt' = IF op.kind = "add" THEN trakt \cup {op.play} ELSE trakt \ op.plays
  /\ queue' = Tail(queue)
  /\ UNCHANGED <<at, ui, want, upc, rpc, stamp, began, used, unmarks, clock>>

(* endWrite's read back: once no write to the show is pending.              *)
ReadBack ==
  /\ queue = <<>>
  /\ ui' = (trakt # {})
  /\ UNCHANGED <<trakt, at, queue, want, upc, rpc, stamp, began, used, unmarks, clock>>

Next ==
  \/ MarkSeason \/ RewatchSeason \/ MarkEpisode
  \/ UnmarkStart \/ UnmarkRead \/ RemoveAllStart \/ RemoveAllRead
  \/ Send \/ Deliver \/ ReadBack

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
Quiet == queue = <<>> /\ upc = "idle" /\ rpc = "idle"

(* Once nothing is queued or being read, Trakt agrees with the user.        *)
IntentHonored == Quiet => ((trakt # {}) = want)
=============================================================================
