import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.mediaTag.deleteMany();
  await prisma.media.deleteMany();
  await prisma.tag.deleteMany();

  await Promise.all(
    [
      { text: "travel", slug: "travel" },
      { text: "tokyo", slug: "tokyo" },
      { text: "family", slug: "family" },
      { text: "sunset", slug: "sunset" },
      { text: "hike", slug: "hike" },
    ].map((t) => prisma.tag.create({ data: t })),
  );

  console.log(
    "Seeded sample tags. Folder structure and media come from S3; captions/tags are created when you edit them in the app.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
