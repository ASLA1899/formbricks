import "server-only";
<<<<<<< HEAD
import type { User } from "@formbricks/database/prisma";
=======
import type { User } from "@prisma/client";
>>>>>>> origin/main

type TAccountDeletionPasswordAuthData = Pick<User, "identityProvider">;

export const requiresPasswordConfirmationForAccountDeletion = ({
  identityProvider,
}: TAccountDeletionPasswordAuthData): boolean => identityProvider === "email";
