import { z } from 'zod';

import koaGuard from '#src/middleware/koa-guard.js';

import { EnvSet } from '../../env-set/index.js';
import { encryptUserPassword } from '../../libraries/user.utils.js';
import { buildUserVerificationRecordById } from '../../libraries/verification.js';
import koaOidcAuth from '../../middleware/koa-auth/koa-oidc-auth.js';
import assertThat from '../../utils/assert-that.js';
import type { UserRouter, RouterInitArgs } from '../types.js';

export default function profileRoutes<T extends UserRouter>(
  ...[router, { provider, queries, libraries }]: RouterInitArgs<T>
) {
  const {
    users: { updateUserById },
  } = queries;

  router.use(koaOidcAuth(provider));

  if (!EnvSet.values.isDevFeaturesEnabled) {
    return;
  }

  router.post(
    '/profile/password',
    koaGuard({
      body: z.object({ password: z.string().min(1), verificationRecordId: z.string() }),
      status: [204, 400],
    }),
    async (ctx, next) => {
      const { id: userId } = ctx.auth;
      const { password, verificationRecordId } = ctx.guard.body;

      // TODO(LOG-9947): apply password policy
      // TODO(LOG-10005): trigger user updated webhook

      const verificationRecord = await buildUserVerificationRecordById(
        userId,
        verificationRecordId,
        queries,
        libraries
      );
      assertThat(verificationRecord.isVerified, 'verification_record.not_found');

      const { passwordEncrypted, passwordEncryptionMethod } = await encryptUserPassword(password);
      await updateUserById(userId, { passwordEncrypted, passwordEncryptionMethod });

      ctx.status = 204;

      return next();
    }
  );
}
