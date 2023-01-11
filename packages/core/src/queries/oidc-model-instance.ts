import type {
  OidcModelInstance,
  CreateOidcModelInstance,
  OidcModelInstancePayload,
} from '@logto/schemas';
import { OidcModelInstances } from '@logto/schemas';
import { convertToIdentifiers, convertToTimestamp } from '@logto/shared';
import type { Nullable } from '@silverhand/essentials';
import { conditional } from '@silverhand/essentials';
import { addSeconds, isBefore } from 'date-fns';
import type { CommonQueryMethods, ValueExpression } from 'slonik';
import { sql } from 'slonik';

import { buildInsertIntoWithPool } from '#src/database/insert-into.js';
import envSet from '#src/env-set/index.js';

export type WithConsumed<T> = T & { consumed?: boolean };
export type QueryResult = Pick<OidcModelInstance, 'payload' | 'consumedAt'>;

const { table, fields } = convertToIdentifiers(OidcModelInstances);

const isConsumed = (modelName: string, consumedAt: Nullable<number>): boolean => {
  if (!consumedAt) {
    return false;
  }

  const { refreshTokenReuseInterval } = envSet.oidc;

  if (modelName !== 'RefreshToken' || !refreshTokenReuseInterval) {
    return Boolean(consumedAt);
  }

  return isBefore(addSeconds(consumedAt, refreshTokenReuseInterval), Date.now());
};

const withConsumed = <T>(
  data: T,
  modelName: string,
  consumedAt: Nullable<number>
): WithConsumed<T> => ({
  ...data,
  ...(isConsumed(modelName, consumedAt) ? { consumed: true } : undefined),
});

// eslint-disable-next-line @typescript-eslint/ban-types
const convertResult = (result: QueryResult | null, modelName: string) =>
  conditional(result && withConsumed(result.payload, modelName, result.consumedAt));

const findByModel = (modelName: string) => sql`
  select ${fields.payload}, ${fields.consumedAt}
  from ${table}
  where ${fields.modelName}=${modelName}
`;

export const createOidcModelInstanceQueries = (pool: CommonQueryMethods) => {
  const upsertInstance = buildInsertIntoWithPool(pool)<CreateOidcModelInstance>(
    OidcModelInstances,
    {
      onConflict: {
        fields: [fields.modelName, fields.id],
        setExcludedFields: [fields.payload, fields.expiresAt],
      },
    }
  );

  const findPayloadById = async (modelName: string, id: string) => {
    const result = await pool.maybeOne<QueryResult>(sql`
      ${findByModel(modelName)}
      and ${fields.id}=${id}
    `);

    return convertResult(result, modelName);
  };

  const findPayloadByPayloadField = async <
    T extends ValueExpression,
    Field extends keyof OidcModelInstancePayload
  >(
    modelName: string,
    field: Field,
    value: T
  ) => {
    const result = await pool.maybeOne<QueryResult>(sql`
      ${findByModel(modelName)}
      and ${fields.payload}->>${field}=${value}
    `);

    return convertResult(result, modelName);
  };

  const consumeInstanceById = async (modelName: string, id: string) => {
    await pool.query(sql`
      update ${table}
      set ${fields.consumedAt}=${convertToTimestamp()}
      where ${fields.modelName}=${modelName}
      and ${fields.id}=${id}
    `);
  };

  const destroyInstanceById = async (modelName: string, id: string) => {
    await pool.query(sql`
      delete from ${table}
      where ${fields.modelName}=${modelName}
      and ${fields.id}=${id}
    `);
  };

  const revokeInstanceByGrantId = async (modelName: string, grantId: string) => {
    await pool.query(sql`
      delete from ${table}
      where ${fields.modelName}=${modelName}
      and ${fields.payload}->>'grantId'=${grantId}
    `);
  };

  const revokeInstanceByUserId = async (modelName: string, userId: string) => {
    await pool.query(sql`
      delete from ${table}
      where ${fields.modelName}=${modelName}
      and ${fields.payload}->>'accountId'=${userId}
    `);
  };

  return {
    upsertInstance,
    findPayloadById,
    findPayloadByPayloadField,
    consumeInstanceById,
    destroyInstanceById,
    revokeInstanceByGrantId,
    revokeInstanceByUserId,
  };
};
