---- MODULE SessionLifecycle_TTrace_1795589239 ----
EXTENDS Sequences, TLCExt, Toolbox, Naturals, TLC, SessionLifecycle

_expression ==
    LET SessionLifecycle_TEExpression == INSTANCE SessionLifecycle_TEExpression
    IN SessionLifecycle_TEExpression!expression
----

_trace ==
    LET SessionLifecycle_TETrace == INSTANCE SessionLifecycle_TETrace
    IN SessionLifecycle_TETrace!trace
----

_inv ==
    ~(
        TLCGet("level") = Len(_TETrace)
        /\
        phase = ("connected")
        /\
        soStarted = (0)
        /\
        rt = ("ended")
        /\
        session = (0)
        /\
        droppedAtRest = (FALSE)
        /\
        signIns = (0)
        /\
        token = ("stored")
        /\
        dt = ("idle")
        /\
        ending = ("none")
        /\
        wrongEnd = (FALSE)
        /\
        soError = (TRUE)
        /\
        so = ("idle")
        /\
        rtSession = (0)
    )
----

_init ==
    /\ ending = _TETrace[1].ending
    /\ wrongEnd = _TETrace[1].wrongEnd
    /\ rt = _TETrace[1].rt
    /\ so = _TETrace[1].so
    /\ session = _TETrace[1].session
    /\ token = _TETrace[1].token
    /\ signIns = _TETrace[1].signIns
    /\ soError = _TETrace[1].soError
    /\ droppedAtRest = _TETrace[1].droppedAtRest
    /\ phase = _TETrace[1].phase
    /\ dt = _TETrace[1].dt
    /\ soStarted = _TETrace[1].soStarted
    /\ rtSession = _TETrace[1].rtSession
----

_next ==
    /\ \E i,j \in DOMAIN _TETrace:
        /\ \/ /\ j = i + 1
              /\ i = TLCGet("level")
        /\ ending  = _TETrace[i].ending
        /\ ending' = _TETrace[j].ending
        /\ wrongEnd  = _TETrace[i].wrongEnd
        /\ wrongEnd' = _TETrace[j].wrongEnd
        /\ rt  = _TETrace[i].rt
        /\ rt' = _TETrace[j].rt
        /\ so  = _TETrace[i].so
        /\ so' = _TETrace[j].so
        /\ session  = _TETrace[i].session
        /\ session' = _TETrace[j].session
        /\ token  = _TETrace[i].token
        /\ token' = _TETrace[j].token
        /\ signIns  = _TETrace[i].signIns
        /\ signIns' = _TETrace[j].signIns
        /\ soError  = _TETrace[i].soError
        /\ soError' = _TETrace[j].soError
        /\ droppedAtRest  = _TETrace[i].droppedAtRest
        /\ droppedAtRest' = _TETrace[j].droppedAtRest
        /\ phase  = _TETrace[i].phase
        /\ phase' = _TETrace[j].phase
        /\ dt  = _TETrace[i].dt
        /\ dt' = _TETrace[j].dt
        /\ soStarted  = _TETrace[i].soStarted
        /\ soStarted' = _TETrace[j].soStarted
        /\ rtSession  = _TETrace[i].rtSession
        /\ rtSession' = _TETrace[j].rtSession

\* Uncomment the ASSUME below to write the states of the error trace
\* to the given file in Json format. Note that you can pass any tuple
\* to `JsonSerialize`. For example, a sub-sequence of _TETrace.
    \* ASSUME
    \*     LET J == INSTANCE Json
    \*         IN J!JsonSerialize("SessionLifecycle_TTrace_1795589239.json", _TETrace)

=============================================================================

 Note that you can extract this module `SessionLifecycle_TEExpression`
  to a dedicated file to reuse `expression` (the module in the 
  dedicated `SessionLifecycle_TEExpression.tla` file takes precedence 
  over the module `SessionLifecycle_TEExpression` below).

---- MODULE SessionLifecycle_TEExpression ----
EXTENDS Sequences, TLCExt, Toolbox, Naturals, TLC, SessionLifecycle

expression == 
    [
        \* To hide variables of the `SessionLifecycle` spec from the error trace,
        \* remove the variables below.  The trace will be written in the order
        \* of the fields of this record.
        ending |-> ending
        ,wrongEnd |-> wrongEnd
        ,rt |-> rt
        ,so |-> so
        ,session |-> session
        ,token |-> token
        ,signIns |-> signIns
        ,soError |-> soError
        ,droppedAtRest |-> droppedAtRest
        ,phase |-> phase
        ,dt |-> dt
        ,soStarted |-> soStarted
        ,rtSession |-> rtSession
        
        \* Put additional constant-, state-, and action-level expressions here:
        \* ,_stateNumber |-> _TEPosition
        \* ,_endingUnchanged |-> ending = ending'
        
        \* Format the `ending` variable as Json value.
        \* ,_endingJson |->
        \*     LET J == INSTANCE Json
        \*     IN J!ToJson(ending)
        
        \* Lastly, you may build expressions over arbitrary sets of states by
        \* leveraging the _TETrace operator.  For example, this is how to
        \* count the number of times a spec variable changed up to the current
        \* state in the trace.
        \* ,_endingModCount |->
        \*     LET F[s \in DOMAIN _TETrace] ==
        \*         IF s = 1 THEN 0
        \*         ELSE IF _TETrace[s].ending # _TETrace[s-1].ending
        \*             THEN 1 + F[s-1] ELSE F[s-1]
        \*     IN F[_TEPosition - 1]
    ]

=============================================================================



Parsing and semantic processing can take forever if the trace below is long.
 In this case, it is advised to uncomment the module below to deserialize the
 trace from a generated binary file.

\*
\*---- MODULE SessionLifecycle_TETrace ----
\*EXTENDS IOUtils, TLC, SessionLifecycle
\*
\*trace == IODeserialize("SessionLifecycle_TTrace_1795589239.bin", TRUE)
\*
\*=============================================================================
\*

---- MODULE SessionLifecycle_TETrace ----
EXTENDS TLC, SessionLifecycle

trace == 
    <<
    ([phase |-> "connected",soStarted |-> 0,rt |-> "none",session |-> 0,droppedAtRest |-> FALSE,signIns |-> 0,token |-> "stored",dt |-> "idle",ending |-> "none",wrongEnd |-> FALSE,soError |-> FALSE,so |-> "idle",rtSession |-> 0]),
    ([phase |-> "connected",soStarted |-> 0,rt |-> "live",session |-> 0,droppedAtRest |-> FALSE,signIns |-> 0,token |-> "stored",dt |-> "idle",ending |-> "none",wrongEnd |-> FALSE,soError |-> FALSE,so |-> "idle",rtSession |-> 0]),
    ([phase |-> "connected",soStarted |-> 0,rt |-> "live",session |-> 0,droppedAtRest |-> FALSE,signIns |-> 0,token |-> "stored",dt |-> "idle",ending |-> "none",wrongEnd |-> FALSE,soError |-> FALSE,so |-> "flushing",rtSession |-> 0]),
    ([phase |-> "connected",soStarted |-> 0,rt |-> "ended",session |-> 0,droppedAtRest |-> FALSE,signIns |-> 0,token |-> "stored",dt |-> "idle",ending |-> "running",wrongEnd |-> FALSE,soError |-> FALSE,so |-> "ending",rtSession |-> 0]),
    ([phase |-> "connected",soStarted |-> 0,rt |-> "ended",session |-> 0,droppedAtRest |-> FALSE,signIns |-> 0,token |-> "stored",dt |-> "idle",ending |-> "none",wrongEnd |-> FALSE,soError |-> TRUE,so |-> "idle",rtSession |-> 0])
    >>
----


=============================================================================

---- CONFIG SessionLifecycle_TTrace_1795589239 ----
CONSTANTS
    ClearCanFail = TRUE
    TokenReadCanFail = TRUE
    MaxSignIns = 2
    FixRestoreOnFail = FALSE

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
\* Generated on Wed Nov 25 06:47:20 UTC 2026