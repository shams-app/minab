grammar Minab

entry Model:
    (declarations+=Declaration)*
    (tail=MainStatement)?;

Declaration:
    BodyStatement | FunctionDecl;

MainStatement:
    Query | Expression;

Query:
    'FROM' source=FromSource ('AS' alias=Name)?
    joins+=JoinClause*
    (whereClause=WhereClause)?
    (groupByClause=GroupByClause)?
    (havingClause=HavingClause)?
    (selectClause=SelectClause)?
    (orderByClause=OrderByClause)?
    (limitClause=LimitClause)?;

FromSource infers Expression:
    TableRef | NamedScope | CurrentRecord ({infer FilterAccess.receiver=current} '[' filter=Expression ']')?;

TableRef infers Expression:
    {infer TableRef} name=QualifiedName;

JoinClause:
    (left?='LEFTJOIN' | cross?='CROSSJOIN' | 'JOIN') source=QualifiedName 'AS' alias=Name
    ('ON' condition=Expression)?;

WhereClause:
    'WHERE' condition=Expression;

GroupByClause:
    'GROUPBY' keys+=GroupKey (',' keys+=GroupKey)*;

GroupKey:
    expression=Expression ('AS' alias=Name)?;

HavingClause:
    'HAVING' condition=Expression;

SelectClause:
    'SELECT' distinct?='DISTINCT'? (all?='*' | items+=SelectItem (',' items+=SelectItem)*);

SelectItem:
    expression=Expression ('AS' alias=Name)?;

OrderByClause:
    'ORDERBY' items+=OrderItem (',' items+=OrderItem)*;

OrderItem:
    expression=Expression direction=('ASC' | 'DESC')?;

LimitClause:
    'LIMIT' limit=NUMBER ('OFFSET' offset=NUMBER)?;

VariableDecl:
    'let' name=Name ':' type=Type ('=' value=Expression)? ';';

Type:
    TypeRef | TupleType;

TupleType:
    '(' elementTypes+=Type (',' elementTypes+=Type)+ ')';

TypeRef:
    base=(
        'TEXT' | 'CITEXT' | 'INTEGER' | 'DECIMAL' | 'BOOLEAN' |
        'DATE' | 'TIME' | 'DATETIME' | 'UUID' | 'JSON'
    )
    nullable?='?'?
    (array?='[]' arrayNullable?='?'?)?;

FunctionDecl:
    'fn' name=Name '(' (params+=Param (',' params+=Param)*)? ')' ':' returnType=Type
    '{' (body+=BodyStatement)* (tail=MainStatement)? '}';

Param:
    name=Name ':' type=Type;

BodyStatement:
    VariableDecl | AssignmentStatement | LoopStatement | BreakStatement | ContinueStatement
    | InsertStatement | DeleteStatement | UpdateStatement | IfStatement;

InsertStatement:
    'INSERT' target=Expression 'VALUES' payload=ValuesPayload ';';

ValuesPayload:
    Query | Expression;

DeleteStatement:
    'DELETE' target=Expression
    (whereClause=WhereClause)?
    (orderByClause=OrderByClause)?
    (limitClause=LimitClause)? ';';

UpdateStatement:
    'UPDATE' target=Expression
    (whereClause=WhereClause)?
    (orderByClause=OrderByClause)?
    (limitClause=LimitClause)?
    setClause=SetClause ';';

SetClause:
    'SET' '{' (assignments+=SetAssignment (',' assignments+=SetAssignment)*)? '}';

SetAssignment:
    key=(Name | STRING) operator=('+:' | '-:' | '*:' | '/:' | ':|' | ':') value=Expression;

AssignmentStatement:
    target=Expression operator=('=' | '+=' | '-=' | '*=' | '/=' | '?=' | '|=') value=Expression ';';

LoopStatement:
    (label=Name ':')?
    'loop'
    ( (variable=Name 'from' lowerBound=Expression 'to' upperBound=Expression
        (stepClause=StepClause | whereClause=WhereGuard)?)
    | (variable=Name 'in' iterable=Expression (whereClause=WhereGuard)?)
    | condition=Expression
    )
    '{' (statements+=BodyStatement)* (tail=MainStatement)? '}';

StepClause:
    'by' step=Expression;

WhereGuard:
    'where' condition=Expression;

BreakStatement:
    'break' (label=Name)? ';';

ContinueStatement:
    'continue' (label=Name)? ';';

// A name as the user writes it: a plain name (ID) or a backtick name
// (QUOTED_NAME). Everything user-facing uses this rule. The value converter
// (`minab-value-converter.ts`) removes the backticks and the escapes.
Name returns string:
    ID | QUOTED_NAME;

QualifiedName returns string:
    Name ('.' Name)*;

Expression:
    Or;

Or infers Expression:
    And ({infer BinaryExpression.left=current} operator='OR' right=And)*;

And infers Expression:
    Not ({infer BinaryExpression.left=current} operator='AND' right=Not)*;

Not infers Expression:
    {infer UnaryExpression} negated?='NOT' operand=Not
    | Comparison;

Comparison infers Expression:
    Additive (
        {infer BinaryExpression.left=current}
            operator=('==' | '!=' | '<=' | '>=' | '<' | '>' | 'IN' | 'LIKE')
            right=Additive
      | {infer TypeTestExpression.value=current}
            operator=('is' | 'isnot')
            test=JsonKind
    )?;

Additive infers Expression:
    Multiplicative ({infer BinaryExpression.left=current} operator=('+' | '-') right=Multiplicative)*;

Multiplicative infers Expression:
    Unary ({infer BinaryExpression.left=current} operator=('*' | '/' | '%' | INTEGER_DIVISION) right=Unary)*;

Unary infers Expression:
    {infer UnaryExpression} operator=('-' | '+') operand=Unary
    | Postfix;

Postfix infers Expression:
    Primary (
        {infer MemberAccess.receiver=current} '.' member=Name vivify?='!'?
      | {infer TupleAccess.receiver=current} '[' index=NUMBER ']'
      | {infer FilterAccess.receiver=current} '[' filter=Expression ']'
      | {infer CallExpression.callee=current} '(' (args+=Expression (',' args+=Expression)*)? ')'
    )*;

Primary infers Expression:
    StringLiteral
    | NumberLiteral
    | BooleanLiteral
    | NullLiteral
    | CurrentRecord
    | FieldValue
    | ParentRecord
    | NamedScope
    | CastExpr
    | GroupKeyRef
    | IndexRef
    | ListLiteral
    | JsonObjectLiteral
    | Subquery
    | ParenOrTuple
    | IfExpr
    | SwitchExpr
    | NameRef;

CurrentRecord infers Expression:
    {infer CurrentRecord} '.' (field=Name vivify?='!'?)?;

FieldValue infers Expression:
    {infer FieldValue} '$';

ParentRecord infers Expression:
    {infer ParentRecord} '^';

NamedScope infers Expression:
    {infer NamedScope} '#' name=Name;

CastExpr infers Expression:
    {infer CastExpr} 'CAST' '(' value=Expression 'AS' targetType=TypeRef ')';

JsonKind:
    NullLiteral | ArrayKind | ObjectKind | StringKind | NumberKind | BooleanKind;

ArrayKind infers Expression:
    {infer ArrayKind} 'array';

ObjectKind infers Expression:
    {infer ObjectKind} 'object';

StringKind infers Expression:
    {infer StringKind} 'string';

NumberKind infers Expression:
    {infer NumberKind} 'number';

BooleanKind infers Expression:
    {infer BooleanKind} 'boolean';

GroupKeyRef infers Expression:
    {infer GroupKeyRef} 'KEY';

IndexRef infers Expression:
    {infer IndexRef} '.$index';

NameRef infers Expression:
    {infer NameRef} name=Name;

StringLiteral infers Expression:
    {infer StringLiteral} value=STRING;

NumberLiteral infers Expression:
    {infer NumberLiteral} value=NUMBER;

BooleanLiteral infers Expression:
    {infer BooleanLiteral} value=('true' | 'false');

NullLiteral infers Expression:
    {infer NullLiteral} ('null' | 'NULL');

ListLiteral infers Expression:
    {infer ListLiteral} '[' (items+=Expression (',' items+=Expression)*)? ']';

JsonObjectLiteral infers Expression:
    {infer JsonObjectLiteral} '{' (properties+=JsonProperty (',' properties+=JsonProperty)*)? '}';

JsonProperty:
    (key=Name (':' value=Expression)?) | (key=STRING ':' value=Expression);

Subquery infers Expression:
    {infer Subquery} '(' query=Query ')';

ParenOrTuple infers Expression:
    '(' Expression ({infer TupleLiteral.items+=current} (',' items+=Expression)+)? ')';

IfExpr infers Expression:
    {infer IfExpr} 'if' condition=Expression thenBranch=Block
    ('else' (elseIf=IfExpr | elseBranch=Block))?;

IfStatement:
    'if!' condition=Expression thenBranch=Block
    ('else' (elseIf=IfStatementElse | elseBranch=Block))?;

IfStatementElse:
    'if' condition=Expression thenBranch=Block
    ('else' (elseIf=IfStatementElse | elseBranch=Block))?;

SwitchExpr infers Expression:
    {infer SwitchExpr} 'switch' subject=Expression '{'
        (cases+=SwitchCase ',')*
        '_' '=>' defaultResult=SwitchResult
        ','?
    '}';

SwitchCase:
    values+=SwitchCaseValue (',' values+=SwitchCaseValue)* '=>' result=SwitchResult;

SwitchCaseValue:
    StringLiteral | NumberLiteral | BooleanLiteral | NullLiteral;

SwitchResult:
    Block | Expression;

Block infers Expression:
    {infer Block} '{' (statements+=BodyStatement)* (tail=MainStatement)? '}';

// Plain names: any Unicode letter or "_" first; then letters, digits, "_",
// and (not first) U+200C and U+200D (zero-width non-joiner and joiner, used
// inside Persian words). Written with Unicode property escapes (\p{L}, \p{N}
// and the "u" flag). Keywords stay ASCII; a longer name wins over a keyword
// ("FROMا" is a name).
terminal ID: /[\p{L}_][\p{L}\p{N}_\u200C\u200D]*/u;
// Backtick names: any text between backticks. "\`" is a backtick, "\\" a backslash.
terminal QUOTED_NAME: /`([^`\\]|\\[\s\S])*`/;
terminal NUMBER returns number: /[0-9]+(\.[0-9]+)?/;
// `\` outside a string or a backtick name is integer division. It is a terminal, not a keyword,
// because Langium writes a keyword that is a lone backslash into `ast.ts` without escaping it.
terminal INTEGER_DIVISION: /\\/;

terminal STRING: /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/;

hidden terminal WS: /\s+/;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
