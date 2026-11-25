---- MODULE CrossKeyUnmark_TTrace_1795589237 ----
EXTENDS Sequences, CrossKeyUnmark, TLCExt, Toolbox, Naturals, TLC

_expression ==
    LET CrossKeyUnmark_TEExpression == INSTANCE CrossKeyUnmark_TEExpression
    IN CrossKeyUnmark_TEExpression!expression
----

_trace ==
    LET CrossKeyUnmark_TETrace == INSTANCE CrossKeyUnmark_TETrace
    IN CrossKeyUnmark_TETrace!trace
----

_inv ==
    ~(
        TLCGet("level") = Len(_TETrace)
        /\
        at = ([p0 |-> 0, pS |-> 0, pR |-> 1, pE |-> 0])
        /\
        rpc = ("idle")
        /\
        ui = (FALSE)
        /\
        began = (2)
        /\
        unmarks = (0)
        /\
        want = (FALSE)
        /\
        upc = ("idle")
        /\
        stamp = (1)
        /\
        used = ({"rewatch", "removeAll"})
        /\
        trakt = ({"pR"})
        /\
        clock = (2)
        /\
        queue = (<<>>)
    )
----

_init ==
    /\ unmarks = _TETrace[1].unmarks
    /\ rpc = _TETrace[1].rpc
    /\ at = _TETrace[1].at
    /\ upc = _TETrace[1].upc
    /\ began = _TETrace[1].began
    /\ want = _TETrace[1].want
    /\ used = _TETrace[1].used
    /\ ui = _TETrace[1].ui
    /\ trakt = _TETrace[1].trakt
    /\ queue = _TETrace[1].queue
    /\ clock = _TETrace[1].clock
    /\ stamp = _TETrace[1].stamp
----

_next ==
    /\ \E i,j \in DOMAIN _TETrace:
        /\ \/ /\ j = i + 1
              /\ i = TLCGet("level")
        /\ unmarks  = _TETrace[i].unmarks
        /\ unmarks' = _TETrace[j].unmarks
        /\ rpc  = _TETrace[i].rpc
        /\ rpc' = _TETrace[j].rpc
        /\ at  = _TETrace[i].at
        /\ at' = _TETrace[j].at
        /\ upc  = _TETrace[i].upc
        /\ upc' = _TETrace[j].upc
        /\ began  = _TETrace[i].began
        /\ began' = _TETrace[j].began
        /\ want  = _TETrace[i].want
        /\ want' = _TETrace[j].want
        /\ used  = _TETrace[i].used
        /\ used' = _TETrace[j].used
        /\ ui  = _TETrace[i].ui
        /\ ui' = _TETrace[j].ui
        /\ trakt  = _TETrace[i].trakt
        /\ trakt' = _TETrace[j].trakt
        /\ queue  = _TETrace[i].queue
        /\ queue' = _TETrace[j].queue
        /\ clock  = _TETrace[i].clock
        /\ clock' = _TETrace[j].clock
        /\ stamp  = _TETrace[i].stamp
        /\ stamp' = _TETrace[j].stamp

\* Uncomment the ASSUME below to write the states of the error trace
\* to the given file in Json format. Note that you can pass any tuple
\* to `JsonSerialize`. For example, a sub-sequence of _TETrace.
    \* ASSUME
    \*     LET J == INSTANCE Json
    \*         IN J!JsonSerialize("CrossKeyUnmark_TTrace_1795589237.json", _TETrace)

=============================================================================

 Note that you can extract this module `CrossKeyUnmark_TEExpression`
  to a dedicated file to reuse `expression` (the module in the 
  dedicated `CrossKeyUnmark_TEExpression.tla` file takes precedence 
  over the module `CrossKeyUnmark_TEExpression` below).

---- MODULE CrossKeyUnmark_TEExpression ----
EXTENDS Sequences, CrossKeyUnmark, TLCExt, Toolbox, Naturals, TLC

expression == 
    [
        \* To hide variables of the `CrossKeyUnmark` spec from the error trace,
        \* remove the variables below.  The trace will be written in the order
        \* of the fields of this record.
        unmarks |-> unmarks
        ,rpc |-> rpc
        ,at |-> at
        ,upc |-> upc
        ,began |-> began
        ,want |-> want
        ,used |-> used
        ,ui |-> ui
        ,trakt |-> trakt
        ,queue |-> queue
        ,clock |-> clock
        ,stamp |-> stamp
        
        \* Put additional constant-, state-, and action-level expressions here:
        \* ,_stateNumber |-> _TEPosition
        \* ,_unmarksUnchanged |-> unmarks = unmarks'
        
        \* Format the `unmarks` variable as Json value.
        \* ,_unmarksJson |->
        \*     LET J == INSTANCE Json
        \*     IN J!ToJson(unmarks)
        
        \* Lastly, you may build expressions over arbitrary sets of states by
        \* leveraging the _TETrace operator.  For example, this is how to
        \* count the number of times a spec variable changed up to the current
        \* state in the trace.
        \* ,_unmarksModCount |->
        \*     LET F[s \in DOMAIN _TETrace] ==
        \*         IF s = 1 THEN 0
        \*         ELSE IF _TETrace[s].unmarks # _TETrace[s-1].unmarks
        \*             THEN 1 + F[s-1] ELSE F[s-1]
        \*     IN F[_TEPosition - 1]
    ]

=============================================================================



Parsing and semantic processing can take forever if the trace below is long.
 In this case, it is advised to uncomment the module below to deserialize the
 trace from a generated binary file.

\*
\*---- MODULE CrossKeyUnmark_TETrace ----
\*EXTENDS IOUtils, CrossKeyUnmark, TLC
\*
\*trace == IODeserialize("CrossKeyUnmark_TTrace_1795589237.bin", TRUE)
\*
\*=============================================================================
\*

---- MODULE CrossKeyUnmark_TETrace ----
EXTENDS CrossKeyUnmark, TLC

trace == 
    <<
    ([at |-> [p0 |-> 0, pS |-> 0, pR |-> 0, pE |-> 0],rpc |-> "idle",ui |-> TRUE,began |-> 0,unmarks |-> 0,want |-> TRUE,upc |-> "idle",stamp |-> 0,used |-> {},trakt |-> {"p0"},clock |-> 1,queue |-> <<>>]),
    ([at |-> [p0 |-> 0, pS |-> 0, pR |-> 1, pE |-> 0],rpc |-> "idle",ui |-> TRUE,began |-> 1,unmarks |-> 0,want |-> TRUE,upc |-> "idle",stamp |-> 0,used |-> {"rewatch"},trakt |-> {"p0"},clock |-> 2,queue |-> <<[key |-> "show:X:bulk:add", kind |-> "add", play |-> "pR", plays |-> {}, sent |-> FALSE]>>]),
    ([at |-> [p0 |-> 0, pS |-> 0, pR |-> 1, pE |-> 0],rpc |-> "reading",ui |-> TRUE,began |-> 1,unmarks |-> 0,want |-> FALSE,upc |-> "idle",stamp |-> 1,used |-> {"rewatch", "removeAll"},trakt |-> {"p0"},clock |-> 2,queue |-> <<[key |-> "show:X:bulk:add", kind |-> "add", play |-> "pR", plays |-> {}, sent |-> FALSE]>>]),
    ([at |-> [p0 |-> 0, pS |-> 0, pR |-> 1, pE |-> 0],rpc |-> "idle",ui |-> FALSE,began |-> 2,unmarks |-> 0,want |-> FALSE,upc |-> "idle",stamp |-> 1,used |-> {"rewatch", "removeAll"},trakt |-> {"p0"},clock |-> 2,queue |-> <<[key |-> "show:X:bulk:add", kind |-> "add", play |-> "pR", plays |-> {}, sent |-> FALSE], [key |-> "history-plays", kind |-> "remove", play |-> "none", plays |-> {"p0"}, sent |-> FALSE]>>]),
    ([at |-> [p0 |-> 0, pS |-> 0, pR |-> 1, pE |-> 0],rpc |-> "idle",ui |-> FALSE,began |-> 2,unmarks |-> 0,want |-> FALSE,upc |-> "idle",stamp |-> 1,used |-> {"rewatch", "removeAll"},trakt |-> {"p0"},clock |-> 2,queue |-> <<[key |-> "show:X:bulk:add", kind |-> "add", play |-> "pR", plays |-> {}, sent |-> TRUE], [key |-> "history-plays", kind |-> "remove", play |-> "none", plays |-> {"p0"}, sent |-> FALSE]>>]),
    ([at |-> [p0 |-> 0, pS |-> 0, pR |-> 1, pE |-> 0],rpc |-> "idle",ui |-> FALSE,began |-> 2,unmarks |-> 0,want |-> FALSE,upc |-> "idle",stamp |-> 1,used |-> {"rewatch", "removeAll"},trakt |-> {"p0", "pR"},clock |-> 2,queue |-> <<[key |-> "history-plays", kind |-> "remove", play |-> "none", plays |-> {"p0"}, sent |-> FALSE]>>]),
    ([at |-> [p0 |-> 0, pS |-> 0, pR |-> 1, pE |-> 0],rpc |-> "idle",ui |-> FALSE,began |-> 2,unmarks |-> 0,want |-> FALSE,upc |-> "idle",stamp |-> 1,used |-> {"rewatch", "removeAll"},trakt |-> {"p0", "pR"},clock |-> 2,queue |-> <<[key |-> "history-plays", kind |-> "remove", play |-> "none", plays |-> {"p0"}, sent |-> TRUE]>>]),
    ([at |-> [p0 |-> 0, pS |-> 0, pR |-> 1, pE |-> 0],rpc |-> "idle",ui |-> FALSE,began |-> 2,unmarks |-> 0,want |-> FALSE,upc |-> "idle",stamp |-> 1,used |-> {"rewatch", "removeAll"},trakt |-> {"pR"},clock |-> 2,queue |-> <<>>])
    >>
----


=============================================================================

---- CONFIG CrossKeyUnmark_TTrace_1795589237 ----
CONSTANTS
    PriorPlay = TRUE
    AllowRewatch = TRUE
    MaxUnmarks = 2
    FixWaitForWrites = FALSE

INVARIANT
    _inv

CHECK_DEADLOCK
    \* CHECK_DEADLOCK off because of PROPERTY or INVARIANT above.
    FALSE

INIT
    _init

NEXT
    _next

CONSTANT
    _TETrace <- _trace

ALIAS
    _expression
=============================================================================
\* Generated on Wed Nov 25 06:47:17 UTC 2026