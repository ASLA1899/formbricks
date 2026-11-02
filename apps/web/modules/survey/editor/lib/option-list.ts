import { prisma } from "@formbricks/database";
import { Prisma } from "@formbricks/database/prisma";
import { DatabaseError, UniqueConstraintError } from "@formbricks/types/errors";
import { TOptionList, TOptionListInput } from "@formbricks/types/option-list";
import { isUniqueConstraintError } from "@/lib/utils/prisma-constraint";

const toDatabaseError = (error: unknown): never => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    throw new DatabaseError(error.message);
  }
  throw error;
};

export const getOptionListsByWorkspaceId = async (workspaceId: string): Promise<TOptionList[]> => {
  try {
    return await prisma.optionList.findMany({
      where: { workspaceId },
      orderBy: { name: "asc" },
    });
  } catch (error) {
    return toDatabaseError(error);
  }
};

export const getOptionList = async (id: string): Promise<TOptionList | null> => {
  try {
    return await prisma.optionList.findUnique({ where: { id } });
  } catch (error) {
    return toDatabaseError(error);
  }
};

export const createOptionList = async (
  workspaceId: string,
  data: TOptionListInput
): Promise<TOptionList> => {
  try {
    return await prisma.optionList.create({
      data: {
        workspaceId,
        name: data.name,
        options: data.options,
      },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new UniqueConstraintError(`An option list named "${data.name}" already exists in this workspace`);
    }
    return toDatabaseError(error);
  }
};

export const deleteOptionList = async (id: string): Promise<void> => {
  try {
    await prisma.optionList.delete({ where: { id } });
  } catch (error) {
    toDatabaseError(error);
  }
};
