import { namedTypes, builders } from "ast-types";
import { TSTypeKind } from "ast-types/gen/kinds";
import {
  FieldKind,
  ObjectField,
  ScalarField,
  ScalarType,
} from "prisma-schema-dsl";
import { EntityField } from "../../types";
import {
  createEnumName,
  createPrismaField,
} from "../../prisma/create-prisma-schema";
import { classProperty } from "../../util/ast";
import { isEnumField } from "../../util/field";
import {
  IS_BOOLEAN_ID,
  IS_DATE_ID,
  IS_ENUM_ID,
  IS_INT_ID,
  IS_NUMBER_ID,
  IS_OPTIONAL_ID,
  IS_STRING_ID,
  VALIDATE_NESTED_ID,
} from "./class-validator.util";
import { TYPE_ID } from "./class-transformer.util";
import { createEnumMembers } from "./create-enum-dto";
import { createWhereUniqueInputID } from "./create-where-unique-input";

const PRISMA_SCALAR_TO_TYPE: {
  [scalar in ScalarType]: TSTypeKind;
} = {
  [ScalarType.Boolean]: builders.tsBooleanKeyword(),
  [ScalarType.DateTime]: builders.tsTypeReference(builders.identifier("Date")),
  [ScalarType.Float]: builders.tsNumberKeyword(),
  [ScalarType.Int]: builders.tsNumberKeyword(),
  [ScalarType.String]: builders.tsStringKeyword(),
  [ScalarType.Json]: builders.tsUnknownKeyword(),
};
const PRISMA_SCALAR_TO_DECORATOR_ID: {
  [scalar in ScalarType]: namedTypes.Identifier | null;
} = {
  [ScalarType.Boolean]: IS_BOOLEAN_ID,
  [ScalarType.DateTime]: IS_DATE_ID,
  [ScalarType.Float]: IS_NUMBER_ID,
  [ScalarType.Int]: IS_INT_ID,
  [ScalarType.String]: IS_STRING_ID,
  [ScalarType.Json]: null,
};

export function createFieldClassProperty(
  field: EntityField,
  optional: boolean,
  isInput: boolean,
  entityIdToName: Record<string, string>
): namedTypes.ClassProperty {
  const prismaField = createPrismaField(field, entityIdToName);
  const id = builders.identifier(field.name);
  const isEnum = isEnumField(field);
  const type = createFieldValueTypeFromPrismaField(
    field,
    prismaField,
    isInput,
    isEnum
  );
  const typeAnnotation = builders.tsTypeAnnotation(type);
  const decorators: namedTypes.Decorator[] = [];

  if (prismaField.isList && prismaField.kind === FieldKind.Object) {
    optional = true;
  }
  const optionalProperty = optional && isInput;
  const definitive = !optionalProperty;

  if (prismaField.kind === FieldKind.Scalar) {
    const id = PRISMA_SCALAR_TO_DECORATOR_ID[prismaField.type];
    if (id) {
      const args = prismaField.isList
        ? [
            builders.objectExpression([
              builders.objectProperty(
                builders.identifier("each"),
                builders.booleanLiteral(true)
              ),
            ]),
          ]
        : [];
      decorators.push(builders.decorator(builders.callExpression(id, args)));
    }
  }
  if (isEnum) {
    decorators.push(
      builders.decorator(
        builders.callExpression(IS_ENUM_ID, [
          builders.identifier(createEnumName(field)),
        ])
      )
    );
  } else if (prismaField.kind === FieldKind.Object) {
    let typeName;
    if (namedTypes.TSUnionType.check(type)) {
      const objectType = type.types.find(
        (type) =>
          namedTypes.TSTypeReference.check(type) &&
          namedTypes.Identifier.check(type.typeName)
      ) as namedTypes.TSTypeReference & { typeName: namedTypes.Identifier };
      typeName = objectType.typeName;
    } else if (
      namedTypes.TSTypeReference.check(type) &&
      namedTypes.Identifier.check(type.typeName)
    ) {
      typeName = type.typeName;
    }
    if (!typeName) {
      throw new Error(`Unexpected type: ${type}`);
    }
    decorators.push(
      builders.decorator(builders.callExpression(VALIDATE_NESTED_ID, [])),
      builders.decorator(
        builders.callExpression(TYPE_ID, [
          builders.arrowFunctionExpression([], typeName),
        ])
      )
    );
  }
  if (optional) {
    decorators.push(
      builders.decorator(builders.callExpression(IS_OPTIONAL_ID, []))
    );
  }
  return classProperty(
    id,
    typeAnnotation,
    definitive,
    optionalProperty,
    null,
    decorators
  );
}

export function createFieldValueTypeFromPrismaField(
  field: EntityField,
  prismaField: ScalarField | ObjectField,
  isInput: boolean,
  isEnum: boolean
): TSTypeKind {
  if (!prismaField.isRequired) {
    const type = createFieldValueTypeFromPrismaField(
      field,
      {
        ...prismaField,
        isRequired: true,
      },
      isInput,
      isEnum
    );
    return builders.tsUnionType([type, builders.tsNullKeyword()]);
  }
  if (prismaField.isList) {
    const itemPrismaField = {
      ...prismaField,
      isList: false,
    };
    const itemType = createFieldValueTypeFromPrismaField(
      field,
      itemPrismaField,
      isInput,
      isEnum
    );
    return builders.tsArrayType(itemType);
  }
  if (prismaField.kind === FieldKind.Scalar) {
    return PRISMA_SCALAR_TO_TYPE[prismaField.type];
  }
  if (isEnum) {
    const members = createEnumMembers(field);
    return builders.tsUnionType(
      members.map((member) => builders.tsLiteralType(member.initializer))
    );
  }
  return builders.tsTypeReference(createWhereUniqueInputID(prismaField.type));
}
