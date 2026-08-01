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

export async function updateCaption(mediaId: string, caption: string) {
  await requireUser();

  await prisma.media.update({
    where: { id: mediaId },
    data: { caption: caption.trim() || null },
  });

  revalidatePath("/browse", "layout");
  revalidatePath("/search");
}

export async function setMediaTags(mediaId: string, tagTexts: string[]) {
  await requireUser();

  const media = await prisma.media.findUnique({ where: { id: mediaId } });
  if (!media) throw new Error("Media not found");

  const tags = await findOrCreateTags(tagTexts);
  const tagIds = new Set(tags.map((t) => t.id));

  const existing = await prisma.mediaTag.findMany({
    where: { mediaId },
  });

  const toDelete = existing.filter((mt) => !tagIds.has(mt.tagId));
  const existingTagIds = new Set(existing.map((mt) => mt.tagId));
  const toCreate = tags.filter((t) => !existingTagIds.has(t.id));

  await prisma.$transaction([
    ...toDelete.map((mt) =>
      prisma.mediaTag.delete({
        where: { mediaId_tagId: { mediaId, tagId: mt.tagId } },
      }),
    ),
    ...toCreate.map((t) =>
      prisma.mediaTag.create({
        data: { mediaId, tagId: t.id },
      }),
    ),
  ]);

  revalidatePath("/browse", "layout");
  revalidatePath("/search");
}
