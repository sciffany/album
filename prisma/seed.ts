import { PrismaClient, MediaType, Source } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.mediaTag.deleteMany();
  await prisma.media.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.folder.deleteMany();

  const family = await prisma.folder.create({
    data: { name: "Family", path: "Family" },
  });

  const year = await prisma.folder.create({
    data: {
      name: "2024",
      path: "Family/2024",
      parentId: family.id,
    },
  });

  const japan = await prisma.folder.create({
    data: {
      name: "Japan Trip",
      path: "Family/2024/Japan Trip",
      parentId: year.id,
    },
  });

  const nature = await prisma.folder.create({
    data: { name: "Nature", path: "Nature" },
  });

  const tags = await Promise.all(
    [
      { text: "travel", slug: "travel" },
      { text: "tokyo", slug: "tokyo" },
      { text: "family", slug: "family" },
      { text: "sunset", slug: "sunset" },
      { text: "hike", slug: "hike" },
    ].map((t) => prisma.tag.create({ data: t })),
  );

  const tag = (slug: string) => tags.find((t) => t.slug === slug)!;

  const mediaRows = [
    {
      source: Source.s3,
      url: "https://picsum.photos/id/1015/1200/800",
      thumbnailPath: "https://picsum.photos/id/1015/400/400",
      dateTaken: new Date("2024-04-12T10:00:00Z"),
      mediaType: MediaType.photo,
      caption: "Morning walk near the temple gates",
      aiCaption: "Stone path lined with lanterns in soft morning light",
      folderId: japan.id,
      tagSlugs: ["travel", "tokyo", "family"],
    },
    {
      source: Source.google_photos,
      url: "https://picsum.photos/id/1016/1200/800",
      thumbnailPath: "https://picsum.photos/id/1016/400/400",
      dateTaken: new Date("2024-04-14T18:30:00Z"),
      mediaType: MediaType.photo,
      caption: "Shibuya crossing at dusk",
      aiCaption: "Busy city intersection with neon lights",
      folderId: japan.id,
      tagSlugs: ["travel", "tokyo"],
    },
    {
      source: Source.mega,
      url: "https://picsum.photos/id/1018/1200/800",
      thumbnailPath: "https://picsum.photos/id/1018/400/400",
      dateTaken: new Date("2023-09-02T16:00:00Z"),
      mediaType: MediaType.photo,
      caption: "Golden hour on the ridge",
      aiCaption: "Mountain ridge silhouette against orange sunset sky",
      folderId: nature.id,
      tagSlugs: ["sunset", "hike"],
    },
    {
      source: Source.s3,
      url: "https://picsum.photos/id/1025/1200/800",
      thumbnailPath: "https://picsum.photos/id/1025/400/400",
      dateTaken: new Date("2024-01-20T12:00:00Z"),
      mediaType: MediaType.meme,
      caption: "Dog tax for the group chat",
      aiCaption: "Close-up of a curious dog looking at the camera",
      folderId: family.id,
      tagSlugs: ["family"],
    },
  ];

  for (const row of mediaRows) {
    const { tagSlugs, ...data } = row;
    const media = await prisma.media.create({ data });
    await prisma.mediaTag.createMany({
      data: tagSlugs.map((slug) => ({
        mediaId: media.id,
        tagId: tag(slug).id,
      })),
    });
  }

  console.log("Seeded folders, tags, and media.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
