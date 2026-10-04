/**
 * The registry of diagnostics and run errors (B1, R4, decision D35).
 *
 * Every diagnostic the checker makes has a stable code, a severity, an
 * English message built from parameters, and one sentence that explains the
 * problem and the fix. A host (Shamsine) can translate a message by its code
 * and fill it with the parameters. Minab ships English only.
 *
 * Rules:
 *  - A code is `<area>.<camelCaseName>`. Areas: syntax, scope, type, null, call, compile, eval, limit, data, query, rule, wire.
 *    One code has no area: `cancelled` (the host aborted the run).
 *  - Keep the entries sorted by code. A test checks it.
 *  - Do not change a message here without a reason: tests and users read it.
 *  - After you change an entry, run `npm run docs:diagnostics`.
 *  - From 1.0 on, a code never changes its meaning (D38).
 */

export type DiagnosticParamValue = string | number;
export type DiagnosticParams = Record<string, DiagnosticParamValue>;
/** Parameters of a diagnostic that has none. */
export type NoParams = Record<never, never>;

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface DiagnosticEntry<P extends DiagnosticParams = DiagnosticParams> {
    severity: DiagnosticSeverity;
    /** Today's English text, built from the parameters. */
    message: (params: P) => string;
    /** One sentence: what is wrong and how to fix it. */
    doc: string;
}

function entry<P extends DiagnosticParams = NoParams>(value: DiagnosticEntry<P>): DiagnosticEntry<P> {
    return value;
}

const error = 'error' as const;

export const DIAGNOSTICS = {
    'call.argumentType': entry<{
        name: string;
        position: number;
        expected: string;
        actual: string;
    }>({
        severity: error,
        message: p => `"${p.name}" argument ${p.position}: expected ${p.expected}, got ${p.actual} (no implicit coercion)`,
        doc: 'An argument of a user function must have the declared parameter type. Pass a value of that type, or use CAST.'
    }),
    'call.builtinArity': entry<{ name: string; actual: number }>({
        severity: error,
        message: p => `${p.name} expects exactly one argument, got ${p.actual}`,
        doc: 'A built-in function takes exactly one argument. Pass one collection.'
    }),
    'call.builtinNeedsBooleanCollection': entry<{ name: string; actual: string }>({
        severity: error,
        message: p => `${p.name} expects a collection of BOOLEAN, got ${p.actual}`,
        doc: 'ALL and ANY read a collection of BOOLEAN values. Pass such a collection, for example a filter or a comparison over a collection.'
    }),
    'call.builtinNeedsCollection': entry<{ name: string; actual: string }>({
        severity: error,
        message: p => `${p.name} expects a collection, got ${p.actual}`,
        doc: 'COUNT and EXISTS read a collection or an array. Pass one, for example a to-many relation.'
    }),
    'call.builtinNeedsNumericCollection': entry<{ name: string; actual: string }>({
        severity: error,
        message: p => `${p.name} expects a collection of INTEGER or DECIMAL, got ${p.actual}`,
        doc: 'SUM and AVG add up numbers. Pass a collection of INTEGER or DECIMAL values.'
    }),
    'call.builtinNeedsOrderableCollection': entry<{
        name: string;
        actual: string;
    }>({
        severity: error,
        message: p => `${p.name} expects a collection of an orderable type, got ${p.actual}`,
        doc: 'MIN and MAX compare values. Pass a collection of numbers, text, dates or times.'
    }),
    'call.calleeNotName': entry({
        severity: error,
        message: () => 'a function call must be a plain name — e.g. COUNT(...) or myFunction(...)',
        doc: 'Only a plain name can be called. Write the function name before the parentheses.'
    }),
    'call.functionNameCase': entry<{ name: string }>({
        severity: error,
        message: p => `"${p.name}" is not a valid function name — a function name needs a lowercase letter; ALL-CAPS names are kept for built-ins`,
        doc: 'Built-in functions have ALL-CAPS names. A function you declare must contain at least one lowercase letter, so a new built-in can never clash with it.'
    }),
    'call.unknownDateUnit': entry<{ name: string; unit: string; allowed: string }>({
        severity: error,
        message: p => `${p.name}: the unit ${p.unit} is not allowed here — use a text literal that is one of ${p.allowed}`,
        doc: 'The unit of a date function must be a text literal such as "day", written in the call. A DATE accepts year, month, week and day; a DATETIME also accepts hour, minute and second.'
    }),
    'call.unknownFunction': entry<{ name: string }>({
        severity: error,
        message: p => `unknown function "${p.name}"`,
        doc: 'The name is not a built-in function and no function with this name is declared. Declare it with "fn", or fix the name.'
    }),
    'call.userArity': entry<{ name: string; expected: number; actual: number }>({
        severity: error,
        message: p => `"${p.name}" expects ${p.expected} argument(s), got ${p.actual}`,
        doc: 'A user function needs one argument for each declared parameter. Add or remove arguments.'
    }),

    'call.wrongArgumentCount': entry<{ name: string; expected: string; actual: number }>({
        severity: error,
        message: p => `${p.name} expects ${p.expected} argument(s), got ${p.actual}`,
        doc: 'A built-in function needs the number of arguments its signature says. Some arguments are optional, and some functions take any number from a minimum on. Add or remove arguments.'
    }),
    cancelled: entry({
        severity: error,
        message: () => 'the run was cancelled',
        doc: 'The host aborted the run with its AbortSignal. Nothing is wrong with the program.'
    }),

    'compile.blockInQuery': entry({
        severity: error,
        message: () => 'a block with statements cannot run inside a query (a statement cannot become SQL)',
        doc: 'A query is one SQL statement, so an if or switch arm in it may hold only its tail expression. Remove the statements, or run the logic outside the query.'
    }),
    'compile.hostFunctionInSql': entry<{ name: string }>({
        severity: error,
        message: p => `"${p.name}" is a host function — it runs in the host, never in SQL`,
        doc: "A host function is the host's own code, so it cannot become SQL. Use the interpreter (run), or move the call out of the query."
    }),
    'compile.notSql': entry<{ reason: string }>({
        severity: error,
        message: p => `this program does not compile to SQL on its own: ${p.reason}`,
        doc: 'Part of the program has no SQL form (for example a user function or a statement). The interpreter runs it; use run instead of compile.'
    }),
    'compile.nothingToCompile': entry({
        severity: error,
        message: () => 'nothing to compile: the program has no query or expression',
        doc: 'A program with only declarations has no value to turn into SQL. Add a query or an expression at the end.'
    }),
    'compile.programHasErrors': entry({
        severity: error,
        message: () => 'the program has errors, so it cannot be compiled',
        doc: 'Fix the diagnostics of the program first. A program with errors is never compiled.'
    }),
    'data.error': entry({
        severity: error,
        message: () => 'the data source failed',
        doc: 'The data port failed. params.sqlstate holds the SQLSTATE when the driver gave one. The SQL text is never part of the error: read it from the statement event.'
    }),
    'data.noPort': entry({
        severity: error,
        message: () => 'this program needs data, and no data port was given',
        doc: 'The program reads a table, but the host gave run no data port. Give a data port, or run a program that needs no data.'
    }),
    'eval.castFailed': entry<{ value: string; from: string; to: string }>({
        severity: error,
        message: p => `cannot cast ${p.value} to ${p.to}`,
        doc: 'The value has no valid form in the target type (for example "12a" as INTEGER, or a decimal too big for INTEGER). Check the value first, or cast a different value.'
    }),
    'eval.divisionByZero': entry({
        severity: error,
        message: () => 'division by zero',
        doc: '"/" and "%" fail when the right side is zero. Check the divisor first, for example with "if".'
    }),
    'eval.failed': entry<{ reason: string }>({
        severity: error,
        message: p => p.reason,
        doc: 'The program failed while it ran. params.reason has the English reason. Specific failures have their own code.'
    }),
    'eval.hostFunctionFailed': entry<{ name: string }>({
        severity: error,
        message: p => `the host function "${p.name}" failed`,
        doc: 'The host function threw an error. The text of that error is not copied here. The host can log it.'
    }),
    'eval.hostFunctionMissing': entry<{ name: string }>({
        severity: error,
        message: p => `the host function "${p.name}" was called, and the host gave no implementation`,
        doc: 'The program calls a host function that was declared, but run got no implementation of it. Give it in the ports of run.'
    }),
    'eval.integerOutOfRange': entry({
        severity: error,
        message: () => 'an INTEGER result is outside the safe range of -9007199254740991 to 9007199254740991',
        doc: 'INTEGER values are whole numbers in the safe JavaScript range. Use DECIMAL for larger numbers.'
    }),

    'eval.missingInput': entry<{ name: string }>({
        severity: error,
        message: p => `the host input "${p.name}" has no value for this run`,
        doc: 'The program reads a declared host input, but run got no value for it. Give a value in the hostInputs of run.'
    }),
    'eval.programInvalid': entry({
        severity: error,
        message: () => 'the program has errors, so it cannot run',
        doc: 'Fix the diagnostics of the program first. A program with errors never runs.'
    }),
    'eval.writesNotSupported': entry({
        severity: error,
        message: () => 'this run has no write port, so the program cannot write',
        doc: 'The program writes data, and the host gave run no write port. Give a write port, or remove the write.'
    }),

    'limit.callDepth': entry<{ limit: number }>({
        severity: error,
        message: p => `function calls are nested deeper than the limit of ${p.limit}`,
        doc: 'A function calls itself, or other functions, too deeply. Remove the recursion, or ask the host for a higher callDepth limit.'
    }),
    'limit.sourceTooLong': entry<{ limit: number; used: number }>({
        severity: error,
        message: p => `the source is ${p.used} bytes, and the limit is ${p.limit}`,
        doc: 'The program text is longer than the host allows (UTF-8 bytes). Make the program shorter.'
    }),
    'limit.timeout': entry<{ limit: number }>({
        severity: error,
        message: p => `the run took longer than the limit of ${p.limit} ms`,
        doc: 'The run used all of its wall time. Make the program cheaper, or ask the host for a higher wallTimeMs limit.'
    }),
    'limit.tooDeep': entry<{ limit: number; used: number }>({
        severity: error,
        message: p => `expressions are nested ${p.used} levels deep, and the limit is ${p.limit}`,
        doc: 'The expressions are nested too deeply. Split the expression into several let variables.'
    }),
    'limit.tooManyIterations': entry<{ limit: number }>({
        severity: error,
        message: p => `the run went over the limit of ${p.limit} loop iterations`,
        doc: 'The loops ran too many times in one run. Loop over fewer items, or ask the host for a higher loopIterations limit.'
    }),
    'limit.tooManyRows': entry<{ limit: number }>({
        severity: error,
        message: p => `a statement returned more than the limit of ${p.limit} rows`,
        doc: 'One statement returned too many rows. Filter the query, or ask the host for a higher rowsPerStatement limit.'
    }),
    'limit.tooManyStatements': entry<{ limit: number }>({
        severity: error,
        message: p => `the run went over the limit of ${p.limit} statements sent to the data source`,
        doc: 'The run sent too many statements to the data port. Combine queries, or ask the host for a higher statements limit.'
    }),

    'null.likeWithNull': entry({
        severity: error,
        message: () => `"LIKE" doesn't accept null as an operand`,
        doc: 'LIKE cannot match null. Test for null with "is null" first, or use a text value.'
    }),
    'null.optionalAssignNeedsNullable': entry({
        severity: error,
        message: () => '"?=" requires a nullable target',
        doc: 'The "?=" operator assigns only when the target is null. Declare the target as nullable, for example TEXT?.'
    }),
    'null.orderingWithNull': entry<{ operator: string }>({
        severity: error,
        message: p => `"${p.operator}" doesn't accept null as an operand`,
        doc: 'An ordering comparison (<, <=, >, >=) with null has no answer. Test for null explicitly instead.'
    }),

    'query.duplicateGroupKeyName': entry<{ name: string }>({
        severity: error,
        message: p => `the GROUPBY key name "${p.name}" is used twice`,
        doc: 'Each GROUPBY key that has a name (AS name) needs its own name. Rename one of them.'
    }),
    'query.functionNotInlinable': entry<{ name: string; reason: string }>({
        severity: error,
        message: p => `the function "${p.name}" cannot be used inside a query: ${p.reason}`,
        doc: 'A query is one SQL statement, so a function used in it is copied into the SQL. Only a function whose body is one expression can be copied: no statements, no recursion, no host functions and no queries. Call it outside the query, or simplify its body.'
    }),
    'query.functionReturnNotJson': entry({
        severity: error,
        message: () => 'a function whose body ends in a query must declare its return type as JSON (spec §8.6)',
        doc: 'A query returns rows, so the function must return JSON. Change the return type to JSON.'
    }),
    'query.inSingleColumnRequired': entry({
        severity: error,
        message: () => 'a subquery used with IN must SELECT exactly one column',
        doc: 'IN compares one value with a list of values. Select exactly one column in the subquery.'
    }),
    'query.keyNeedsName': entry<{ keys: string }>({
        severity: error,
        message: p => `this GROUPBY has several keys, so KEY needs a name: use KEY.<name> (${p.keys})`,
        doc: 'With several GROUPBY keys, KEY is a record of the keys. Read one key as KEY.name, using one of the key names.'
    }),
    'query.singleColumnRequired': entry({
        severity: error,
        message: () => 'a query used as a value must SELECT exactly one column',
        doc: 'A query used as a value gives one column. Select exactly one column, not "*" and not several.'
    }),
    'query.unnamedGroupKey': entry({
        severity: error,
        message: () => 'give this group key a name with AS',
        doc: 'When GROUPBY has several keys, each key needs a name so that KEY.name can read it. A plain field path is named by its last field. Any other key needs AS name.'
    }),

    'rule.fieldTypeMissing': entry({
        severity: error,
        message: () => 'the host did not supply a type for "$" (MinabRuleContext.fieldType)',
        doc: 'This is a host setup problem. The host must give the type of the field when it checks a field-level rule.'
    }),
    'rule.fieldValueOutsideFieldRule': entry({
        severity: error,
        message: () => "'$' is only valid in a field-level rule; this program isn't being validated as one",
        doc: 'The "$" sigil means the field value, and only a field-level rule has one. Use "." for a record-level rule.'
    }),

    'scope.assignToInput': entry<{ name: string }>({
        severity: error,
        message: p => `"${p.name}" is a host input — it is read-only`,
        doc: 'A host input can be read but not changed. Copy it into a let first, and change the copy.'
    }),
    'scope.columnNeedsTable': entry<{ column: string }>({
        severity: error,
        message: p => `column "${p.column}" needs a statically known table (requires the Phase 4 type system)`,
        doc: 'The scope has no known table, so the column cannot be looked up. Open a table first, for example with FROM.'
    }),
    'scope.computedReceiver': entry({
        severity: error,
        message: () => 'member access on a computed receiver requires the Phase 4 type system',
        doc: 'The scope resolver cannot follow a member access on a computed value. Use the type checker for this case.'
    }),
    'scope.currentRecordNoTable': entry({
        severity: error,
        message: () => '"." has no statically known table here',
        doc: 'The current record has no known table. Use "." inside a query, or give the host a record table.'
    }),
    'scope.duplicateLet': entry<{ name: string }>({
        severity: error,
        message: p => `"${p.name}" is already declared in this scope`,
        doc: 'A second let with the same name in the same block is an error. An inner block may declare the name again (it shadows the outer one). Rename it, or assign with "=" instead.'
    }),
    'scope.functionNameIsTable': entry<{ name: string }>({
        severity: error,
        message: p => `"${p.name}" is a table name — a function may not use it`,
        doc: 'A function may not have the name of a table in the schema. Rename the function.'
    }),
    'scope.keyInWrongClause': entry({
        severity: error,
        message: () => 'KEY is only valid in HAVING, SELECT, ORDERBY, or LIMIT, after GROUPBY',
        doc: 'KEY is the group key. Use it only in the clauses that come after GROUPBY.'
    }),
    'scope.keyOutsideQuery': entry({
        severity: error,
        message: () => 'KEY used outside any query',
        doc: 'KEY is the group key of a query. Use it inside a query with GROUPBY.'
    }),
    'scope.keyWithoutGroupBy': entry({
        severity: error,
        message: () => 'KEY is only valid after a GROUPBY clause',
        doc: 'This query has no GROUPBY. Add a GROUPBY clause, or remove KEY.'
    }),
    'scope.nameIsFunction': entry<{ name: string }>({
        severity: error,
        message: p => `"${p.name}" is the name of a function — a variable or parameter may not reuse it`,
        doc: 'A let or a parameter may not have the name of a function declared in the program. Rename it.'
    }),
    'scope.nameIsHostName': entry<{ name: string }>({
        severity: error,
        message: p => `"${p.name}" is the name of a host input or host function — a function, variable or parameter may not reuse it`,
        doc: 'The host declared this name. A fn, a let or a parameter may not use it. Rename yours.'
    }),
    'scope.noActiveScope': entry({
        severity: error,
        message: () => 'no active scope for "."',
        doc: 'There is no current record here. Use "." inside a query, a filter or a loop.'
    }),
    'scope.noParentScope': entry({
        severity: error,
        message: () => '"^" has no enclosing parent scope here',
        doc: 'The "^" sigil means the record one level up. Use it only inside a nested scope.'
    }),
    'scope.noStaticTable': entry({
        severity: error,
        message: () => 'no statically known table at this point',
        doc: 'The checker cannot tell which table this refers to. Open the table explicitly, for example with #Table.'
    }),
    'scope.unknownAlias': entry<{ name: string }>({
        severity: error,
        message: p => `unknown table or scope "#${p.name}"`,
        doc: 'No table or alias has this name. Fix the name, or declare the alias with FROM or JOIN.'
    }),
    'scope.unknownColumn': entry<{ column: string; table: string }>({
        severity: error,
        message: p => `unknown column "${p.column}" on table "${p.table}"`,
        doc: 'The table has no column with this name. Fix the name, or ask the host to add the column to the schema.'
    }),
    'scope.unknownName': entry<{ name: string }>({
        severity: error,
        message: p => `unknown name "${p.name}"`,
        doc: 'No variable, parameter, loop variable or alias has this name in scope. Declare it first, or fix the name.'
    }),
    'scope.unknownTable': entry<{ name: string }>({
        severity: error,
        message: p => `unknown table "${p.name}"`,
        doc: 'The schema has no table with this name. Fix the name, or ask the host to add the table.'
    }),

    'syntax.incompleteExpression': entry({
        severity: error,
        message: () => 'incomplete expression (the program has a syntax error here)',
        doc: 'The program stops in the middle of an expression. Fix the syntax error that is reported with this one.'
    }),
    'syntax.lexer': entry<{ message: string }>({
        severity: error,
        message: p => p.message,
        doc: 'The text has a character or a word that is not part of the language. Remove it or fix the typo. The message comes from the lexer.'
    }),
    'syntax.parser': entry<{ message: string }>({
        severity: error,
        message: p => p.message,
        doc: 'The text does not follow the grammar. Fix the syntax at the marked place. The message comes from the parser.'
    }),

    'type.arithmeticNeedsNumeric': entry<{
        operator: string;
        left: string;
        right: string;
    }>({
        severity: error,
        message: p =>
            `"${p.operator}" requires numeric operands${p.operator === '+' ? ' (or two texts)' : ''}, got ${p.left} and ${p.right}; use CAST to convert one side`,
        doc: 'Arithmetic works on INTEGER and DECIMAL. "+" also joins two texts. Use numbers, or CAST the operands (for example CAST(.n AS TEXT)).'
    }),
    'type.assignMismatch': entry<{ actual: string; expected: string }>({
        severity: error,
        message: p => `can't assign ${p.actual} to a target of type ${p.expected} (no implicit coercion)`,
        doc: 'The value has another type than the target. Use a value of the target type, or CAST it.'
    }),
    'type.assignNeedsNumericTarget': entry<{ operator: string; actual: string }>({
        severity: error,
        message: p => `"${p.operator}" requires a numeric target, got ${p.actual}`,
        doc: 'The operators "-=", "*=" and "/=" work on INTEGER and DECIMAL targets. Use "=" or change the target type.'
    }),
    'type.blockNoValue': entry({
        severity: error,
        message: () => 'a block with no tail has no value',
        doc: 'A block used as a value must end with an expression. Add the expression that gives the value.'
    }),
    'type.cannotDetermine': entry<{ name: string }>({
        severity: error,
        message: p => `cannot determine the type of "${p.name}"`,
        doc: 'The name has no type that the checker can find. Declare it with an explicit type.'
    }),
    'type.cannotInfer': entry<{ nodeType: string }>({
        severity: error,
        message: p => `cannot infer a type for "${p.nodeType}"`,
        doc: 'The checker has no typing rule for this construct. Report it as a Minab bug.'
    }),
    'type.collectionAsGroupKey': entry({
        severity: error,
        message: () => `a to-many collection can't be used as a GROUPBY key (spec §3.4)`,
        doc: 'A GROUPBY key must be one value per row. Group by a scalar column or a to-one relation instead.'
    }),
    'type.columnNeedsTable': entry<{ column: string }>({
        severity: error,
        message: p => `column "${p.column}" needs a statically known table`,
        doc: 'The checker does not know the table of the current record. Open a table first, for example with FROM.'
    }),
    'type.conditionNotBoolean': entry<{ actual: string }>({
        severity: error,
        message: p => `expected a BOOLEAN condition, got ${p.actual}`,
        doc: 'WHERE and HAVING need a BOOLEAN condition. Write a comparison, or CAST the value.'
    }),
    'type.filterOnNonCollection': entry<{ actual: string }>({
        severity: error,
        message: p => `cannot filter a non-collection value (${p.actual})`,
        doc: 'A "[...]" filter works on a collection or an array. Filter one of those.'
    }),
    'type.functionReturnMismatch': entry<{ actual: string; expected: string }>({
        severity: error,
        message: p => `function body's result (${p.actual}) doesn't match its declared return type ${p.expected} (no implicit coercion)`,
        doc: 'The last expression of the function has another type than the declared return type. Change one, or use CAST.'
    }),
    'type.ifBranchesDiffer': entry<{ then: string; else: string }>({
        severity: error,
        message: p => `if/else branches must agree on type (no implicit coercion) — got ${p.then} and ${p.else}`,
        doc: 'Both branches of an if/else must give the same type. Change one branch, or use CAST.'
    }),
    'type.implicitCoercion': entry<{
        operator: string;
        left: string;
        right: string;
    }>({
        severity: error,
        message: p => `"${p.operator}" between ${p.left} and ${p.right} requires an explicit CAST (no implicit coercion)`,
        doc: 'Minab never converts types by itself. Make both sides the same type with CAST.'
    }),
    'type.inCollectionMismatch': entry<{ left: string; right: string }>({
        severity: error,
        message: p => `"IN" between ${p.left} and a collection of ${p.right} requires matching types (no implicit coercion)`,
        doc: 'The value and the elements of the list must have the same type. Use CAST on one side.'
    }),
    'type.inNeedsCollection': entry<{ actual: string }>({
        severity: error,
        message: p => `"IN" expects a list or collection on the right, got ${p.actual}`,
        doc: 'The right side of IN must be a list, an array, a collection or a subquery.'
    }),
    'type.inSubqueryMismatch': entry<{ left: string; right: string }>({
        severity: error,
        message: p => `"IN" between ${p.left} and a subquery of ${p.right} requires matching types (no implicit coercion)`,
        doc: 'The value and the selected column must have the same type. Use CAST on one side.'
    }),
    'type.indexOnNonArray': entry<{ actual: string }>({
        severity: error,
        message: p => `cannot index a non-array value (${p.actual})`,
        doc: 'A position in "[...]" works on an array. Index an array value.'
    }),
    'type.indexOnNonTuple': entry<{ index: number; actual: string }>({
        severity: error,
        message: p => `[${p.index}] used on a non-tuple, non-array value (${p.actual})`,
        doc: 'A position like [0] works on a tuple or an array. Use it on one of those.'
    }),
    'type.initializerMismatch': entry<{
        name: string;
        expected: string;
        actual: string;
    }>({
        severity: error,
        message: p => `can't initialize "${p.name}" (${p.expected}) with ${p.actual} (no implicit coercion)`,
        doc: 'The start value has another type than the declared type. Change one, or use CAST.'
    }),
    'type.invalidFilter': entry({
        severity: error,
        message: () => '"[...]" needs a BOOLEAN filter or an INTEGER index',
        doc: 'Inside "[...]", write a BOOLEAN condition to filter, or an INTEGER to pick a position.'
    }),
    'type.likeNeedsText': entry<{ left: string; right: string }>({
        severity: error,
        message: p => `"LIKE" requires TEXT/CITEXT operands, got ${p.left} and ${p.right}`,
        doc: 'LIKE matches text with a pattern. Use TEXT or CITEXT on both sides, or CAST.'
    }),
    'type.listElementNotScalar': entry<{ actual: string }>({
        severity: error,
        message: p => `list literal elements must be plain scalar values, got ${p.actual}`,
        doc: 'A list literal holds plain values only. Remove the nested list, record or collection.'
    }),
    'type.listElementsMixed': entry<{ first: string; second: string }>({
        severity: error,
        message: p => `list literal elements must share one type (no implicit coercion) — found both ${p.first} and ${p.second}`,
        doc: 'All elements of a list must have the same type. Make them equal, or use CAST.'
    }),
    'type.logicalNeedsBoolean': entry<{
        operator: string;
        left: string;
        right: string;
    }>({
        severity: error,
        message: p => `"${p.operator}" requires BOOLEAN operands, got ${p.left} and ${p.right}`,
        doc: 'AND and OR combine BOOLEAN values. Use comparisons or BOOLEAN columns on both sides.'
    }),
    'type.memberOnNonRecord': entry<{ member: string; actual: string }>({
        severity: error,
        message: p => `"${p.member}" accessed on a non-record value (${p.actual})`,
        doc: 'A ".name" access needs a record or a collection on the left. The left side is a plain value.'
    }),
    'type.mergeAssignTarget': entry<{ actual: string }>({
        severity: error,
        message: p => `"|=" requires a ref- or JSON-typed target, got ${p.actual}`,
        doc: 'The "|=" operator merges into a record or a JSON value. Use another operator, or change the target type.'
    }),
    'type.notIterable': entry<{ actual: string }>({
        severity: error,
        message: p => `cannot iterate over ${p.actual}`,
        doc: 'A loop with "in" needs a collection or an array. Loop over one of those.'
    }),
    'type.notNeedsBoolean': entry<{ actual: string }>({
        severity: error,
        message: p => `"NOT" requires a BOOLEAN operand, got ${p.actual}`,
        doc: 'NOT turns a BOOLEAN into its opposite. Use a comparison or a BOOLEAN value.'
    }),
    'type.orderingNeedsOrderable': entry<{
        operator: string;
        left: string;
        right: string;
    }>({
        severity: error,
        message: p => `"${p.operator}" requires orderable operands, got ${p.left} and ${p.right}`,
        doc: 'Only numbers, text, dates and times have an order. Compare values of one of those types.'
    }),
    'type.plusAssignTarget': entry<{ actual: string }>({
        severity: error,
        message: p => `"+=" requires a numeric or text target, got ${p.actual}`,
        doc: 'The "+=" operator adds numbers or joins text. Use another operator, or change the target type.'
    }),
    'type.positionalIndexOnCollection': entry({
        severity: error,
        message: () => "a positional index isn't valid on a relational collection — its row order isn't guaranteed without ORDERBY (spec §3.5)",
        doc: 'A relation has no fixed row order. Use a query with ORDERBY, or filter with a condition.'
    }),
    'type.relationComparedToKey': entry<{ operator: string; operand: string; key: string }>({
        severity: error,
        message: p => `"${p.operator}" can't compare a relation with a key — compare ${p.key}, not ${p.operand}`,
        doc: 'A relation (ref) is not compared with a key value. Compare through the key field of the related table, for example .customer.id == x.'
    }),
    'type.switchArmsDiffer': entry<{ first: string; second: string }>({
        severity: error,
        message: p => `switch arms must agree on type (no implicit coercion) — got ${p.first} and ${p.second}`,
        doc: 'All arms of a switch must give the same type. Change an arm, or use CAST.'
    }),
    'type.tupleIndexOutOfBounds': entry<{ index: number; count: number }>({
        severity: error,
        message: p => `tuple index ${p.index} out of bounds (tuple has ${p.count} element(s))`,
        doc: 'The position is larger than the tuple. Use a position from 0 to the last element.'
    }),
    'type.unaryNeedsNumeric': entry<{ operator: string; actual: string }>({
        severity: error,
        message: p => `unary "${p.operator}" requires a numeric operand, got ${p.actual}`,
        doc: 'A sign works on INTEGER and DECIMAL. Use a number, or CAST.'
    }),
    'type.unexpectedResultType': entry<{ expected: string; actual: string }>({
        severity: error,
        message: p => `the program gives ${p.actual}, but the host expects ${p.expected}`,
        doc: 'The host asked for a result of one type, and the last expression has another. Change the expression, or use CAST.'
    }),
    'type.unsupportedOperator': entry<{ operator: string }>({
        severity: error,
        message: p => `unsupported operator "${p.operator}"`,
        doc: 'The checker does not know this operator. Report it as a Minab bug.'
    }),
    'type.vivifyOnCollection': entry<{ member: string }>({
        severity: error,
        message: p => `"!" has no use on "${p.member}": a collection is never null, so there is nothing to create`,
        doc: 'The "!" in an assignment path creates a missing ref. A collection is never null (spec §7.7), so "!" on a collection step is an error. Remove the "!".'
    }),

    'wire.invalidRequest': entry<{ path: string; reason: string }>({
        severity: error,
        message: p => `the request is not valid at ${p.path}: ${p.reason}`,
        doc: 'The wire request does not have the shape of wire format v1. params.path says where. Fix the request; the value itself is never copied into the error.'
    }),
    'wire.invalidResponse': entry<{ path: string; reason: string }>({
        severity: error,
        message: p => `the response is not valid at ${p.path}: ${p.reason}`,
        doc: 'The wire response does not have the shape of wire format v1. params.path says where. A client should treat the server as broken.'
    }),
    'wire.invalidValue': entry<{ path: string; expected: string }>({
        severity: error,
        message: p => `the value at ${p.path} is not a valid ${p.expected}`,
        doc: 'A value does not match its Minab type in the wire encoding (for example a JSON number for a DECIMAL, which must be a string). Send the encoding the type needs. The value itself is never copied into the error.'
    }),
    'wire.tooManyRuns': entry<{ limit: number; used: number }>({
        severity: error,
        message: p => `the request has ${p.used} runs, and the limit is ${p.limit}`,
        doc: 'One wire request may hold at most batchRuns runs (100 by default). Send the runs in several requests.'
    }),
    'wire.unsupportedVersion': entry<{ version: string; supported: string }>({
        severity: error,
        message: p => `wire format version ${p.version} is not supported (supported: ${p.supported})`,
        doc: 'The "v" field of the request names a wire format this server does not know. Use one of the supported versions.'
    }),
    'wire.workerFailed': entry<{ reason: string }>({
        severity: error,
        message: p => `the Minab worker failed: ${p.reason}`,
        doc: 'The browser worker could not do the work: it stopped, it was disposed, it did not know the program, or it got a message it could not read. Create the runtime again.'
    })
} as const;

export type DiagnosticCode = keyof typeof DIAGNOSTICS;

type EntryOf<C extends DiagnosticCode> = (typeof DIAGNOSTICS)[C];
export type ParamsOf<C extends DiagnosticCode> = Parameters<EntryOf<C>['message']>[0];

/** The arguments after a code: none when the entry has no parameters, one object otherwise. */
export type ParamsArgs<C extends DiagnosticCode> = keyof ParamsOf<C> extends never ? [] : [params: ParamsOf<C>];

/** A diagnostic before it is placed on a node: its code, its parameters and its English message. */
export interface CodedMessage<C extends DiagnosticCode = DiagnosticCode> {
    code: C;
    params: ParamsOf<C>;
    /** The English message. */
    reason: string;
}

/** Builds the English message for a code and its parameters. */
export function coded<C extends DiagnosticCode>(code: C, ...args: ParamsArgs<C>): CodedMessage<C> {
    const params = (args[0] ?? {}) as ParamsOf<C>;
    const message = DIAGNOSTICS[code].message as (params: ParamsOf<C>) => string;
    return { code, params, reason: message(params) };
}

export function isDiagnosticCode(code: unknown): code is DiagnosticCode {
    return typeof code === 'string' && Object.hasOwn(DIAGNOSTICS, code);
}
