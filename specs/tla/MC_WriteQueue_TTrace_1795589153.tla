---- MODULE MC_WriteQueue_TTrace_1795589153 ----
EXTENDS Sequences, TLCExt, MC_WriteQueue, Toolbox, Naturals, TLC

_expression ==
    LET MC_WriteQueue_TEExpression == INSTANCE MC_WriteQueue_TEExpression
    IN MC_WriteQueue_TEExpression!expression
----

_trace ==
    LET MC_WriteQueue_TETrace == INSTANCE MC_WriteQueue_TETrace
    IN MC_WriteQueue_TETrace!trace
----

_inv ==
    ~(
        TLCGet("level") = Len(_TETrace)
        /\
        owner = ([a |-> "a", b |-> NULL, c |-> NULL, x |-> "x"])
        /\
        dwait = (0)
        /\
        dnext = (NULL)
        /\
        saveWait = (<<>>)
        /\
        applied = ({})
        /\
        pending = (<<[id |-> "x", sent |-> FALSE]>>)
        /\
        subOrder = (<<"x", "a">>)
        /\
        crashes = (0)
        /\
        failedUnsent = ({"a"})
        /\
        saveRun = (NULL)
        /\
        everCancelled = ({})
        /\
        disk = (<<"x", "a">>)
        /\
        applyOrder = (<<>>)
        /\
        submitted = ({"a", "x"})
        /\
        dpc = ("idle")
        /\
        outcome = ([a |-> "failed", b |-> "none", c |-> "none", x |-> "none"])
    )
----

_init ==
    /\ saveWait = _TETrace[1].saveWait
    /\ failedUnsent = _TETrace[1].failedUnsent
    /\ outcome = _TETrace[1].outcome
    /\ dpc = _TETrace[1].dpc
    /\ disk = _TETrace[1].disk
    /\ applied = _TETrace[1].applied
    /\ applyOrder = _TETrace[1].applyOrder
    /\ submitted = _TETrace[1].submitted
    /\ saveRun = _TETrace[1].saveRun
    /\ pending = _TETrace[1].pending
    /\ dwait = _TETrace[1].dwait
    /\ crashes = _TETrace[1].crashes
    /\ everCancelled = _TETrace[1].everCancelled
    /\ subOrder = _TETrace[1].subOrder
    /\ dnext = _TETrace[1].dnext
    /\ owner = _TETrace[1].owner
----

_next ==
    /\ \E i,j \in DOMAIN _TETrace:
        /\ \/ /\ j = i + 1
              /\ i = TLCGet("level")
        /\ saveWait  = _TETrace[i].saveWait
        /\ saveWait' = _TETrace[j].saveWait
        /\ failedUnsent  = _TETrace[i].failedUnsent
        /\ failedUnsent' = _TETrace[j].failedUnsent
        /\ outcome  = _TETrace[i].outcome
        /\ outcome' = _TETrace[j].outcome
        /\ dpc  = _TETrace[i].dpc
        /\ dpc' = _TETrace[j].dpc
        /\ disk  = _TETrace[i].disk
        /\ disk' = _TETrace[j].disk
        /\ applied  = _TETrace[i].applied
        /\ applied' = _TETrace[j].applied
        /\ applyOrder  = _TETrace[i].applyOrder
        /\ applyOrder' = _TETrace[j].applyOrder
        /\ submitted  = _TETrace[i].submitted
        /\ submitted' = _TETrace[j].submitted
        /\ saveRun  = _TETrace[i].saveRun
        /\ saveRun' = _TETrace[j].saveRun
        /\ pending  = _TETrace[i].pending
        /\ pending' = _TETrace[j].pending
        /\ dwait  = _TETrace[i].dwait
        /\ dwait' = _TETrace[j].dwait
        /\ crashes  = _TETrace[i].crashes
        /\ crashes' = _TETrace[j].crashes
        /\ everCancelled  = _TETrace[i].everCancelled
        /\ everCancelled' = _TETrace[j].everCancelled
        /\ subOrder  = _TETrace[i].subOrder
        /\ subOrder' = _TETrace[j].subOrder
        /\ dnext  = _TETrace[i].dnext
        /\ dnext' = _TETrace[j].dnext
        /\ owner  = _TETrace[i].owner
        /\ owner' = _TETrace[j].owner

\* Uncomment the ASSUME below to write the states of the error trace
\* to the given file in Json format. Note that you can pass any tuple
\* to `JsonSerialize`. For example, a sub-sequence of _TETrace.
    \* ASSUME
    \*     LET J == INSTANCE Json
    \*         IN J!JsonSerialize("MC_WriteQueue_TTrace_1795589153.json", _TETrace)

=============================================================================

 Note that you can extract this module `MC_WriteQueue_TEExpression`
  to a dedicated file to reuse `expression` (the module in the 
  dedicated `MC_WriteQueue_TEExpression.tla` file takes precedence 
  over the module `MC_WriteQueue_TEExpression` below).

---- MODULE MC_WriteQueue_TEExpression ----
EXTENDS Sequences, TLCExt, MC_WriteQueue, Toolbox, Naturals, TLC

expression == 
    [
        \* To hide variables of the `MC_WriteQueue` spec from the error trace,
        \* remove the variables below.  The trace will be written in the order
        \* of the fields of this record.
        saveWait |-> saveWait
        ,failedUnsent |-> failedUnsent
        ,outcome |-> outcome
        ,dpc |-> dpc
        ,disk |-> disk
        ,applied |-> applied
        ,applyOrder |-> applyOrder
        ,submitted |-> submitted
        ,saveRun |-> saveRun
        ,pending |-> pending
        ,dwait |-> dwait
        ,crashes |-> crashes
        ,everCancelled |-> everCancelled
        ,subOrder |-> subOrder
        ,dnext |-> dnext
        ,owner |-> owner
        
        \* Put additional constant-, state-, and action-level expressions here:
        \* ,_stateNumber |-> _TEPosition
        \* ,_saveWaitUnchanged |-> saveWait = saveWait'
        
        \* Format the `saveWait` variable as Json value.
        \* ,_saveWaitJson |->
        \*     LET J == INSTANCE Json
        \*     IN J!ToJson(saveWait)
        
        \* Lastly, you may build expressions over arbitrary sets of states by
        \* leveraging the _TETrace operator.  For example, this is how to
        \* count the number of times a spec variable changed up to the current
        \* state in the trace.
        \* ,_saveWaitModCount |->
        \*     LET F[s \in DOMAIN _TETrace] ==
        \*         IF s = 1 THEN 0
        \*         ELSE IF _TETrace[s].saveWait # _TETrace[s-1].saveWait
        \*             THEN 1 + F[s-1] ELSE F[s-1]
        \*     IN F[_TEPosition - 1]
    ]

=============================================================================



Parsing and semantic processing can take forever if the trace below is long.
 In this case, it is advised to uncomment the module below to deserialize the
 trace from a generated binary file.

\*
\*---- MODULE MC_WriteQueue_TETrace ----
\*EXTENDS IOUtils, MC_WriteQueue, TLC
\*
\*trace == IODeserialize("MC_WriteQueue_TTrace_1795589153.bin", TRUE)
\*
\*=============================================================================
\*

---- MODULE MC_WriteQueue_TETrace ----
EXTENDS MC_WriteQueue, TLC

trace == 
    <<
    ([owner |-> [a |-> NULL, b |-> NULL, c |-> NULL, x |-> NULL],dwait |-> 0,dnext |-> NULL,saveWait |-> <<>>,applied |-> {},pending |-> <<>>,subOrder |-> <<>>,crashes |-> 0,failedUnsent |-> {},saveRun |-> NULL,everCancelled |-> {},disk |-> <<>>,applyOrder |-> <<>>,submitted |-> {},dpc |-> "idle",outcome |-> [a |-> "none", b |-> "none", c |-> "none", x |-> "none"]]),
    ([owner |-> [a |-> NULL, b |-> NULL, c |-> NULL, x |-> "x"],dwait |-> 0,dnext |-> NULL,saveWait |-> <<"x">>,applied |-> {},pending |-> <<[id |-> "x", sent |-> FALSE]>>,subOrder |-> <<"x">>,crashes |-> 0,failedUnsent |-> {},saveRun |-> NULL,everCancelled |-> {},disk |-> <<>>,applyOrder |-> <<>>,submitted |-> {"x"},dpc |-> "idle",outcome |-> [a |-> "none", b |-> "none", c |-> "none", x |-> "none"]]),
    ([owner |-> [a |-> "a", b |-> NULL, c |-> NULL, x |-> "x"],dwait |-> 0,dnext |-> NULL,saveWait |-> <<"x", "a">>,applied |-> {},pending |-> <<[id |-> "x", sent |-> FALSE], [id |-> "a", sent |-> FALSE]>>,subOrder |-> <<"x", "a">>,crashes |-> 0,failedUnsent |-> {},saveRun |-> NULL,everCancelled |-> {},disk |-> <<>>,applyOrder |-> <<>>,submitted |-> {"a", "x"},dpc |-> "idle",outcome |-> [a |-> "none", b |-> "none", c |-> "none", x |-> "none"]]),
    ([owner |-> [a |-> "a", b |-> NULL, c |-> NULL, x |-> "x"],dwait |-> 0,dnext |-> NULL,saveWait |-> <<"a">>,applied |-> {},pending |-> <<[id |-> "x", sent |-> FALSE], [id |-> "a", sent |-> FALSE]>>,subOrder |-> <<"x", "a">>,crashes |-> 0,failedUnsent |-> {},saveRun |-> [tag |-> "x", snap |-> <<"x", "a">>],everCancelled |-> {},disk |-> <<>>,applyOrder |-> <<>>,submitted |-> {"a", "x"},dpc |-> "idle",outcome |-> [a |-> "none", b |-> "none", c |-> "none", x |-> "none"]]),
    ([owner |-> [a |-> "a", b |-> NULL, c |-> NULL, x |-> "x"],dwait |-> 0,dnext |-> NULL,saveWait |-> <<"a">>,applied |-> {},pending |-> <<[id |-> "x", sent |-> FALSE], [id |-> "a", sent |-> FALSE]>>,subOrder |-> <<"x", "a">>,crashes |-> 0,failedUnsent |-> {},saveRun |-> NULL,everCancelled |-> {},disk |-> <<"x", "a">>,applyOrder |-> <<>>,submitted |-> {"a", "x"},dpc |-> "idle",outcome |-> [a |-> "none", b |-> "none", c |-> "none", x |-> "none"]]),
    ([owner |-> [a |-> "a", b |-> NULL, c |-> NULL, x |-> "x"],dwait |-> 0,dnext |-> NULL,saveWait |-> <<>>,applied |-> {},pending |-> <<[id |-> "x", sent |-> FALSE], [id |-> "a", sent |-> FALSE]>>,subOrder |-> <<"x", "a">>,crashes |-> 0,failedUnsent |-> {},saveRun |-> [tag |-> "a", snap |-> <<"x", "a">>],everCancelled |-> {},disk |-> <<"x", "a">>,applyOrder |-> <<>>,submitted |-> {"a", "x"},dpc |-> "idle",outcome |-> [a |-> "none", b |-> "none", c |-> "none", x |-> "none"]]),
    ([owner |-> [a |-> "a", b |-> NULL, c |-> NULL, x |-> "x"],dwait |-> 0,dnext |-> NULL,saveWait |-> <<NULL>>,applied |-> {},pending |-> <<[id |-> "x", sent |-> FALSE]>>,subOrder |-> <<"x", "a">>,crashes |-> 0,failedUnsent |-> {"a"},saveRun |-> NULL,everCancelled |-> {},disk |-> <<"x", "a">>,applyOrder |-> <<>>,submitted |-> {"a", "x"},dpc |-> "idle",outcome |-> [a |-> "failed", b |-> "none", c |-> "none", x |-> "none"]]),
    ([owner |-> [a |-> "a", b |-> NULL, c |-> NULL, x |-> "x"],dwait |-> 0,dnext |-> NULL,saveWait |-> <<>>,applied |-> {},pending |-> <<[id |-> "x", sent |-> FALSE]>>,subOrder |-> <<"x", "a">>,crashes |-> 0,failedUnsent |-> {"a"},saveRun |-> [tag |-> NULL, snap |-> <<"x">>],everCancelled |-> {},disk |-> <<"x", "a">>,applyOrder |-> <<>>,submitted |-> {"a", "x"},dpc |-> "idle",outcome |-> [a |-> "failed", b |-> "none", c |-> "none", x |-> "none"]]),
    ([owner |-> [a |-> "a", b |-> NULL, c |-> NULL, x |-> "x"],dwait |-> 0,dnext |-> NULL,saveWait |-> <<>>,applied |-> {},pending |-> <<[id |-> "x", sent |-> FALSE]>>,subOrder |-> <<"x", "a">>,crashes |-> 0,failedUnsent |-> {"a"},saveRun |-> NULL,everCancelled |-> {},disk |-> <<"x", "a">>,applyOrder |-> <<>>,submitted |-> {"a", "x"},dpc |-> "idle",outcome |-> [a |-> "failed", b |-> "none", c |-> "none", x |-> "none"]])
    >>
----


=============================================================================

---- CONFIG MC_WriteQueue_TTrace_1795589153 ----
CONSTANTS
    Ops = { "a" , "b" , "c" , "x" }
    KeyOf <- MCKeyOf
    ToOf <- MCToOf
    TakeBack = { }
    SaveCanFail = TRUE
    MaxCrashes = 0
    RetryFailedSaves = FALSE
    NULL = NULL
    NULL = NULL

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
\* Generated on Wed Nov 25 06:45:54 UTC 2026