---- MODULE MC_WriteQueue ----
EXTENDS WriteQueue
\* a: mark episode E   b: unmark / Undo of E   c: mark E again   x: a write to another item
MCKeyOf == [o \in {"a", "b", "c", "x"} |-> IF o = "x" THEN "X" ELSE "E"]
MCToOf  == [o \in {"a", "b", "c", "x"} |-> IF o = "b" THEN "absent" ELSE "present"]
====
