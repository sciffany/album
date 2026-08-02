"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findOrCreateTags } from "@/lib/tags";

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user;
}

async function ensureMedia(s3Key: string) {
  const key = s3Key.trim();
  if (!key || key.includes("\0") || key.startsWith("/")) {
    throw new Error("Invalid S3 key");
  }
  return prisma.media.upsert({
    where: { s3Key: key },
    create: { s3Key: key },
    update: {},
  });
}

export async function updateCaption(s3Key: string, caption: string) {
  await requireUser();
  const media = await ensureMedia(s3Key);

  await prisma.media.update({
    where: { id: media.id },
    data: { caption: caption.trim() || null },
  });

  revalidatePath("/browse", "layout");
  revalidatePath("/search");
}

export async function setMediaTags(s3Key: string, tagTexts: string[]) {
  await requireUser();
  const media = await ensureMedia(s3Key);

  const tags = await findOrCreateTags(tagTexts);
  const tagIds = new Set(tags.map((t) => t.id));

  const existing = await prisma.mediaTag.findMany({
    where: { mediaId: media.id },
  });

  const toDelete = existing.filter((mt) => !tagIds.has(mt.tagId));
  const existingTagIds = new Set(existing.map((mt) => mt.tagId));
  const toCreate = tags.filter((t) => !existingTagIds.has(t.id));

  await prisma.$transaction([
    ...toDelete.map((mt) =>
      prisma.mediaTag.delete({
        where: { mediaId_tagId: { mediaId: media.id, tagId: mt.tagId } },
      }),
    ),
    ...toCreate.map((t) =>
      prisma.mediaTag.create({
        data: { mediaId: media.id, tagId: t.id },
      }),
    ),
  ]);

  revalidatePath("/browse", "layout");
  revalidatePath("/search");
}
