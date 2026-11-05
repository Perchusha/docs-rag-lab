# TypeScript's golden set, version 2: the questions for review

**All 9 questions that version 2 adds or changes are flagged,** as ADR-0017 asks: ts-0040, revisited, and ts-0046 to ts-0053, the 8 questions on error codes. The other 44 questions of version 1 are unchanged, byte for byte.

The draft is [`questions.draft.jsonl`](questions.draft.jsonl): version 1 with these 9 lines changed or added. Claude drafted it on 2026-11-05 from the text of the plain and compiled indexes' chunks, at docs `205122bb`. Nothing was searched or ranked on either index, and no answer was read.

The repository's check refuses em dashes in this file, so one from the docs would be written as a hyphen. None of these passages has one.

## The checks

- `pnpm drl eval check --draft --source typescript` passes: every anchor resolves on the plain index, and none of the 9 questions copies a heading or a passage.
- The same anchors were resolved with core's own `resolveAnchor` on the compiled index, by a script that only reads it. Every one resolves, and each only to chunks whose `// @errors:` line names the code. The compiled lock is written after the freeze.

## How the codes were chosen

ADR-0017's rule: the codes named in `// @errors:` lines of 2 to 6 chunks of the plain index, 2345 left out, more chunks first, then the lower code. The list is read from the top, and a code is kept when a chunk of the compiled index shows its message, until there are 8. This last part was recorded in the ADR on 2026-11-05, before any replacement was chosen.

| Code | Chunks of the plain index | Compiled chunks that show its message | |
|---|---|---|---|
| TS2367 | 6 | 6 | ts-0046 |
| TS2532 | 6 | 1 | ts-0047 |
| TS2341 | 5 | 5 | ts-0048 |
| TS2540 | 5 | 4 | ts-0049 |
| TS2554 | 4 | 3 | ts-0050 |
| TS2344 | 3 | 3 | ts-0051 |
| TS2375 | 3 | 0 | skipped |
| TS2571 | 3 | 0 | skipped |
| TS7006 | 3 | 2 | ts-0052 |
| TS18046 | 3 | 0 | skipped |
| TS1005 | 2 | 1 | ts-0053 |

TS18046 is named beside TS2571 in the same three examples, and none of them compiled, because typescript 6.0.2 does not raise TS2571 there.

## What the 8 have in common

- **The question is ADR-0017's sentence,** "What does error TS<code> mean?", tagged `exact-token` and `error-code`. It names the code, and the compiled chunks hold it as `Error TS<code>`, which gives keyword search a head start there. That head start is what C1 measures, so the wording stays.
- **The primary anchors are every chunk whose directive names the code,** pinned to the directive line, with `primaryMatch: any`. Some of these examples did not compile, so their chunks show no message even on the compiled index. They stay, by the rule.
- **The expected answer** gives the message as the compiled examples show it, what it means, and what the examples show it on. "X" and "Y" stand for the names in the message.
- **The note** says that the meaning is the main point and the examples are optional, and it reaches the judge.

**To decide for all 8:** whether each expected answer says what you want a fully correct answer to say. The specific points are below.

## ts-0046, TS2367

- **Answer:** TS2367 is "This comparison appears to be unintentional because the types 'X' and 'Y' have no overlap.": two values are compared although their types have no value in common, so the result of the comparison is fixed by the types, which usually points to a logic error. The compiled examples show it on `value === "b"` after `value !== "a"` has already narrowed `value` to `"a"`, on two values from separate `Symbol()` calls, on `shape.kind === "rect"` when `kind` is `"circle" | "square"`, on `x !== E.Foo || x !== E.Bar` with a union enum, on two `unique symbol` constants, and on `settings.dry === 2` where `dry` is a boolean read from a JSON file.
- **Anchors, 6:** `handbook-v2/Basics.md#non-exception-failures`, `handbook-v2/Everyday Types.md#symbol`, `handbook-v2/Narrowing.md#discriminated-unions`, `reference/Enums.md#union-enums-and-enum-member-types`, `reference/Symbols.md#unique-symbol` and the `resolveJsonModule` option page. All 6 show the message on the compiled index.
- **Passage,** `Basics.md#non-exception-failures`, compiled: "Error TS2367 on `} else if (value === "b") {`: This comparison appears to be unintentional because the types '"a"' and '"b"' have no overlap." The docs call it one of the "basic logic errors".
- **To decide:** "the result of the comparison is fixed by the types" is my wording. The docs show the cases and do not state the meaning in general.

## ts-0047, TS2532

- **Answer:** TS2532 is "Object is possibly 'undefined'.": the code uses a value whose type includes `undefined` as if it were there, here by calling a method on it. The compiled example, in the TypeScript 4.1 release notes, shows it under `noUncheckedIndexedAccess` on `opts["foo bar baz"].toString()` and `opts[Math.random()].toString()`, where a property read through an index signature may be `undefined`. The same example shows the two ways out: check that the property is there first, or use the `!` non-null assertion.
- **Anchors, 6:** `handbook-v2/More on Functions.md#optional-parameters-in-callbacks`, `handbook-v2/Narrowing.md#discriminated-unions`, `reference/Advanced Types.md#type-guards-and-type-assertions`, `release-notes/TypeScript 4.0.md#class-property-inference-from-constructors`, `release-notes/TypeScript 4.1.md#checked-indexed-accesses---nouncheckedindexedaccess` and the `strictNullChecks` option page.
- **Passage,** `TypeScript 4.1.md#checked-indexed-accesses---nouncheckedindexedaccess`, compiled: "Error TS2532 on `opts["foo bar baz"].toString();`: Object is possibly 'undefined'." In the same example, "Error TS18048 on `opts.yadda.toString();`: 'opts.yadda' is possibly 'undefined'."
- **The weak one.** Only 1 of its 6 anchors shows the message on the compiled index. In the other 5 examples typescript 6.0.2 does not raise TS2532, so they did not compile. A hit on any of the 6 counts, so on this question the compiled index can score a hit with a chunk that does not state the message.
- **To decide:** whether all 6 stay primary, as the rule says, which is the draft. And whether the note's line on TS18048, which an answer may also mention, should stay.

## ts-0048, TS2341

- **Answer:** TS2341 is "Property 'X' is private and only accessible within class 'Y'.": a member marked `private` is accessed from anywhere other than inside the class that declares it, a subclass included. The compiled examples show it on `b.x` outside `class Base`, on `this.x` in a subclass of `Base`, on `s.secretKey`, while `s["secretKey"]` is allowed, since TypeScript's `private` lets bracket notation through and is only enforced during type checking, on a `private static` member read as `MyClass.x`, on a `private` parameter property read as `a.z`, and, in a checked JavaScript file, on a property marked `@private` in JSDoc.
- **Anchors, 5:** `handbook-v2/Classes.md` at `#private`, `#caveats`, `#static-members` and `#parameter-properties`, and `javascript/JSDoc Reference.md#property-modifiers`. All 5 show the message.
- **Passage,** `Classes.md#private`: "`private` is like `protected`, but doesn't allow access to the member even from subclasses", and, compiled, "Error TS2341 on `console.log(b.x);`: Property 'x' is private and only accessible within class 'Base'."
- **To decide:** whether the bracket notation detail belongs in the answer. It is in the `#caveats` example, and the note makes every example optional.

## ts-0049, TS2540

- **Answer:** TS2540 is "Cannot assign to 'X' because it is a read-only property.": the code assigns to a property that is `readonly`. The compiled examples show it on assignments to a `readonly` class field outside the constructor (`this.name = "not ok"` in a method and `g.name = "also not ok"` on an instance), to `readonly` properties of an interface (`obj.prop = "hello"` and an assignment to `home.resident`), to an element of a `readonly` tuple (`pair[0] = "hello!"`), and to a property of a `Readonly<Todo>` (`todo.title = "Hello"`).
- **Anchors, 5:** `handbook-v2/Classes.md#readonly`, `handbook-v2/Object Types.md` at `#readonly-properties` and `#readonly-tuple-types`, `javascript/JSDoc Reference.md#readonly` and `reference/Utility Types.md#example-3`. 4 show the message. The JSDoc `@readonly` example did not compile.
- **Passage,** `Classes.md#readonly`: "Fields may be prefixed with the `readonly` modifier. This prevents assignments to the field outside of the constructor.", and, compiled, "Error TS2540 on `g.name = "also not ok";`: Cannot assign to 'name' because it is a read-only property."
- **To decide:** nothing specific.

## ts-0050, TS2554

- **Answer:** TS2554 is "Expected N arguments, but got M.": a function is called with more or fewer arguments than its signature takes. The compiled examples show it on `fn()` when the only overload signature takes one argument, because the implementation's signature cannot be seen from outside ("Expected 1 arguments, but got 0."), on calls through variadic tuple types, `partialCall(foo, "hello", 100, true, "oops")` ("Expected 4 arguments, but got 5.") and `f3()` ("Expected 2 arguments, but got 0."), and on `foo("hello", 42, true)` and `foo("hello")` where `foo` takes two parameters ("Expected 2 arguments, but got 3." and "Expected 2 arguments, but got 1.").
- **Anchors, 4:** `handbook-v2/More on Functions.md#overload-signatures-and-the-implementation-signature`, `javascript/Type Checking JavaScript Files.md#function-parameters-are-optional-by-default`, and `release-notes/TypeScript 4.0.md` at `#variadic-tuple-types` and `#labeled-tuple-elements`. 3 show the message. The JavaScript example did not compile.
- **Passage,** `More on Functions.md#overload-signatures-and-the-implementation-signature`, compiled: "Error TS2554 on `fn();`: Expected 1 arguments, but got 0.", then "the signature used to write the function body can't be "seen" from the outside."
- **To decide:** nothing specific. The JavaScript example's prose says that calling a function with too many arguments is an error, which also answers, though its chunk shows no message.

## ts-0051, TS2344

- **Answer:** TS2344 is "Type 'X' does not satisfy the constraint 'Y'.": a type argument does not meet the constraint of the type parameter it is passed to. The compiled examples, in the Utility Types reference, show it on `Parameters<string>`, `Parameters<Function>`, `ReturnType<string>` and `ReturnType<Function>`, whose type parameter must be a function type, `(...args: any) => any`, and on `ConstructorParameters<Function>`, `InstanceType<string>` and `InstanceType<Function>`, whose type parameter must be a constructor type, `abstract new (...args: any) => any`. For `Function` the message adds that it provides no match for that signature.
- **Anchors, 4:** `reference/Utility Types.md` at `#example-10`, `#example-12` and `#example-13`, and `release-notes/TypeScript 4.2.md#abstract-construct-signatures`. 3 show the message. The 4.2 example did not compile.
- **Passage,** `Utility Types.md#example-10`, compiled: "Error TS2344 on `type T6 = Parameters<string>;`: Type 'string' does not satisfy the constraint '(...args: any) => any'."
- **One anchor more than the plain index has chunks.** The compiled index cuts the Utility Types page differently, and the `InstanceType` example, which names 2344, is a chunk of its own there. The anchor on `#example-13` covers it. On the plain index it resolves to the same chunk as `#example-12`. Without it, the compiled index's `InstanceType` chunk would count as a miss.
- **To decide:** whether that anchor stays, which is the draft.

## ts-0052, TS7006, the first replacement

- **Answer:** TS7006 is "Parameter 'X' implicitly has an 'any' type.": a parameter has no type annotation and TypeScript cannot infer one, so it falls back to `any`, which `noImplicitAny` reports as an error. The compiled examples show it on `function fn(s)` with `noImplicitAny` on, and on `check(s)` in a class that `implements Checkable`, where the `implements` clause does not give `s` the interface's `string` type.
- **Anchors, 3:** `handbook-v2/Classes.md#cautions`, `javascript/Type Checking JavaScript Files.md#function-parameters-are-optional-by-default` and the `noImplicitAny` option page. 2 show the message. The JavaScript example did not compile.
- **Passage,** the `noImplicitAny` page: "TypeScript will fall back to a type of `any` for a variable when it cannot infer the type", and, compiled, "Error TS7006 on `function fn(s) {`: Parameter 's' implicitly has an 'any' type."
- **To decide:** nothing specific.

## ts-0053, TS1005, the second replacement

- **Answer:** TS1005 is "'X' expected.", a syntax error: the code cannot be parsed, and the message names the token the compiler expected at that point. The compiled example shows "',' expected." on `let shouldContinue: typeof msgbox("Are you sure you want to continue?");`, because in a type `typeof` may only be used on identifiers or their properties, not on a call. The docs give `ReturnType<typeof msgbox>` as what was meant.
- **Anchors, 2:** `handbook-v2/Type Manipulation/Typeof Type Operator.md#limitations` and `reference/Advanced Types.md#mapped-types`. 1 shows the message. The mapped types example did not compile.
- **Passage,** `Typeof Type Operator.md#limitations`: "it's only legal to use `typeof` on identifiers (i.e. variable names) or their properties", and, compiled, "Error TS1005 on `let shouldContinue: typeof msgbox("Are you sure you want to continue?");`: ',' expected."
- **A judgement call.** The docs show one message, "',' expected.", on one example, and never say what TS1005 means in general. "'X' expected." and "a syntax error" are my reading of the message. The note says that an answer that explains the example's message is fully correct.
- **To decide:** whether the general form stays in the expected answer, or the answer keeps to the example.

## ts-0040, TS2345, revisited

- **Before:** the two release notes primary, and both handbook chunks acceptable, with the note "Revisit this grading after M7."
- **What the compiled index shows.** `Everyday Types.md#literal-inference` gives the message: "Error TS2345 on `handleRequest(req.url, req.method);`: Argument of type 'string' is not assignable to parameter of type '"GET" | "POST"'." The excess property checks example in `Object Types.md#excess-property-checks` did not compile: typescript 6.0.2 raises TS2561 there and not 2345, so that chunk shows no message.
- **The draft:** literal inference becomes a third primary anchor, with `primaryMatch: any` as before. Excess property checks stays acceptable. The expected answer does not change, and the note says why. It still says the handbook shows the error in excess property checks, which is true of the docs as written, `// @errors: 2345 2739`.
- **Not foreseen by ADR-0017,** which says what happens when both chunks state the message or neither does. The draft reads it per chunk.
- **To decide:** the draft's reading, or the other one: neither moves, since only one of the two states it, and only the note changes.

## After the review

Your decisions go into the draft, which becomes `questions.jsonl`. Then `pnpm drl eval check --source typescript --accept --set-version 2` writes the plain lock, `pnpm drl eval check --source typescript --compiled --accept` the compiled one, and ADR-0009's changelog gets version 2. Version 1 stays as `questions.v1.jsonl`, with its lock. All of it goes in one commit, before anything is searched on the compiled index.
