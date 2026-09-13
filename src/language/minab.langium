grammar Minab

entry Model:
    statements+=Statement*;

Statement:
    Query | ValidateStatement | FieldRule;

Query:
    'FROM' source=QualifiedName ('AS' alias=ID)?
    joins+=JoinClause*
    (whereClause=WhereClause)?
    (groupByClause=GroupByClause)?
    (havingClause=HavingClause)?
    (selectClause=SelectClause)?
    (orderByClause=OrderByClause)?
    (limitClause=LimitClause)?;

JoinClause:
    (left?='LEFT' | cross?='CROSS')? 'JOIN' source=QualifiedName 'AS' alias=ID
    ('ON' condition=Expression)?;

WhereClause:
    'WHERE' condition=Expression;

GroupByClause:
    'GROUP' 'BY' keys+=Expression (',' keys+=Expression)*;

HavingClause:
    'HAVING' condition=Expression;

SelectClause:
    'SELECT' items+=SelectItem (',' items+=SelectItem)*;

SelectItem:
    expression=Expression ('AS' alias=ID)?;

OrderByClause:
    'ORDER' 'BY' items+=OrderItem (',' items+=OrderItem)*;

OrderItem:
    expression=Expression direction=('ASC' | 'DESC')?;

LimitClause:
    'LIMIT' limit=NUMBER ('OFFSET' offset=NUMBER)?;

ValidateStatement:
    'VALIDATE' condition=Expression;

FieldRule:
    'field' name=ID ':' condition=Expression;

QualifiedName returns string:
    ID ('.' ID)*;

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
    Additive ({infer BinaryExpression.left=current}
        operator=('==' | '!=' | '<=' | '>=' | '<' | '>' | 'IN' | 'LIKE')
        right=Additive)?;

Additive infers Expression:
    Multiplicative ({infer BinaryExpression.left=current} operator=('+' | '-') right=Multiplicative)*;

Multiplicative infers Expression:
    Unary ({infer BinaryExpression.left=current} operator=('*' | '/' | '%') right=Unary)*;

Unary infers Expression:
    {infer UnaryExpression} operator=('-' | '+') operand=Unary
    | Postfix;

Postfix infers Expression:
    Primary (
        {infer MemberAccess.receiver=current} '.' member=ID
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
    | GroupKeyRef
    | ListLiteral
    | Subquery
    | '(' Expression ')'
    | NameRef;

CurrentRecord infers Expression:
    {infer CurrentRecord} '.' (field=ID)?;

FieldValue infers Expression:
    {infer FieldValue} '$';

ParentRecord infers Expression:
    {infer ParentRecord} '^';

NamedScope infers Expression:
    {infer NamedScope} '@' name=ID;

GroupKeyRef infers Expression:
    {infer GroupKeyRef} 'KEY';

NameRef infers Expression:
    {infer NameRef} name=ID;

StringLiteral infers Expression:
    {infer StringLiteral} value=STRING;

NumberLiteral infers Expression:
    {infer NumberLiteral} value=NUMBER;

BooleanLiteral infers Expression:
    {infer BooleanLiteral} value=('true' | 'false');

NullLiteral infers Expression:
    {infer NullLiteral} 'null';

ListLiteral infers Expression:
    {infer ListLiteral} '[' (items+=Expression (',' items+=Expression)*)? ']';

Subquery infers Expression:
    {infer Subquery} '(' query=Query ')';

terminal ID: /[a-zA-Z_][a-zA-Z0-9_]*/;
terminal NUMBER returns number: /[0-9]+(\.[0-9]+)?/;
terminal STRING: /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/;

hidden terminal WS: /\s+/;
hidden terminal SL_COMMENT: /\/\/[^\n\r]*/;
hidden terminal ML_COMMENT: /\/\*[\s\S]*?\*\//;
