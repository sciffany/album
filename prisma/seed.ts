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
    "Seeded sample tags. Folders/media live in the database; blobs stay in S3.",
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
