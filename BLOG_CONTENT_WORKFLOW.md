# Greenway Blog Content Workflow

This guide explains how Greenway employees can add, remove, and update Blog content. The Blog page is intentionally controlled from one main data file so employees do not need to edit the visual components every time a post is added.

## Main Places to Edit

- Blog post data file: `src/lib/blog/posts.ts`
- Regular blog images: `public/blog/placeholders/` or a new folder under `public/blog/`
- Newsletter PDFs and page images: `public/blog/newsletters/`
- Blog page route: `/blog`
- Individual post route pattern: `/blog/[slug]`

## How the Blog System Works

Every card on the Blog page comes from the `blogPosts` array in `src/lib/blog/posts.ts`. Each object in that array creates one Blog card and one full article page automatically.

Regular posts show a category pill, image, date, title, excerpt, and `READ ARTICLE` button. Newsletter posts are special: the Blog card uses the first page of the newsletter as the tile image and only shows the date plus the `READ ARTICLE` button. When opened, the newsletter page shows the newsletter page images directly, without the extra title/date/Open PDF intro box.

## Adding a Regular Blog Article

1. Add the article image to the project.
   - Recommended folder: `public/blog/your-folder-name/`
   - Example image path: `public/blog/education/edible-guide.png`
   - In the code, public files are referenced without `public`, like this: `/blog/education/edible-guide.png`

2. Open `src/lib/blog/posts.ts`.

3. Copy an existing regular article object, not a newsletter object.
   - Good examples to copy: `fresh-flower-picks`, `edibles-made-simple`, or `weekly-specials-preview`.

4. Paste the copied object into the `blogPosts` array.
   - Place newest posts near the top if you want them to show earlier on the Blog page.
   - Keep commas between objects.

5. Update these fields:
   - `slug`: the URL-safe page name, for example `how-to-read-edible-labels`.
   - `title`: the visible article title.
   - `category`: must be exactly `PRODUCTS`, `DEALS`, `CULTURE`, or `NEWSLETTER`.
   - `kind`: use `"article"` or leave it out for normal blog posts.
   - `publishDate`: machine-readable date, like `2026-08-02`.
   - `dateLabel`: visible date, like `AUG 2, 2026`.
   - `author`: usually `Greenway Team`.
   - `excerpt`: short card description.
   - `image.src`: path to the article image, like `/blog/education/edible-guide.png`.
   - `image.alt`: short description of the image for accessibility.
   - `content`: the full article paragraphs shown on the opened article page.

6. Save the file.

7. Run validation from the `greenway-site` folder:

```bash
npm run lint && npm run build
```

8. Preview the Blog page and the new article URL.
   - Blog page: `/blog`
   - New article: `/blog/your-slug-here`

## Adding a Newsletter Post

1. Create a new folder for that newsletter.
   - Example: `public/blog/newsletters/august-2/`

2. Add the newsletter PDF into that folder and name it clearly.
   - Recommended: `newsletter.pdf`
   - Example: `public/blog/newsletters/august-2/newsletter.pdf`

3. Convert each PDF page into PNG images so the newsletter can be read directly on the site.
   - From the project root/workspace, run a command like:

```bash
pdftoppm -png -r 120 YOUR_NEWSLETTER.pdf greenway-site/public/blog/newsletters/august-2/page
```

This creates files like:

```text
page-1.png
page-2.png
page-3.png
```

4. Open `src/lib/blog/posts.ts`.

5. Copy an existing newsletter object, such as `july-20-newsletter`.

6. Paste it into the `blogPosts` array.
   - Put newer newsletters near the top or wherever you want them to appear in the card order.

7. Update these newsletter fields:
   - `slug`: example `august-2-newsletter`.
   - `title`: example `Greenway Newsletter: August 2`.
   - `category`: must be `NEWSLETTER`.
   - `kind`: must be `"newsletter"`.
   - `publishDate`: set manually to the Sunday date you want, like `2026-08-02`.
   - `dateLabel`: set manually to match the Sunday display date, like `AUG 2, 2026`.
   - `excerpt`: internal SEO/metadata description.
   - `image.src`: use the first page image, like `/blog/newsletters/august-2/page-1.png`.
   - `newsletter.pdfSrc`: the PDF path, like `/blog/newsletters/august-2/newsletter.pdf`.
   - `newsletter.pages`: list every generated page image in order.

8. Example newsletter object:

```ts
{
  slug: "august-2-newsletter",
  title: "Greenway Newsletter: August 2",
  category: "NEWSLETTER",
  kind: "newsletter",
  publishDate: "2026-08-02",
  dateLabel: "AUG 2, 2026",
  author: "Greenway Team",
  excerpt: "Greenway weekly newsletter for Sunday, August 2, 2026.",
  image: {
    src: "/blog/newsletters/august-2/page-1.png",
    alt: "First page of the Greenway August 2 newsletter",
  },
  content: [],
  newsletter: {
    pdfSrc: "/blog/newsletters/august-2/newsletter.pdf",
    pages: [
      "/blog/newsletters/august-2/page-1.png",
      "/blog/newsletters/august-2/page-2.png",
      "/blog/newsletters/august-2/page-3.png",
    ],
  },
}
```

9. Save the file and run:

```bash
npm run lint && npm run build
```

10. Preview the Blog page and the new newsletter route.
   - Blog page: `/blog`
   - Newsletter page: `/blog/august-2-newsletter`

## Removing a Blog Post or Newsletter

1. Open `src/lib/blog/posts.ts`.

2. Find the object with the matching `slug`.

3. Delete that full object from the `blogPosts` array.
   - Be careful to keep commas valid between the remaining objects.

4. If the post used images or newsletter files that are no longer needed, remove the related folder from `public/blog/` or `public/blog/newsletters/`.

5. Run:

```bash
npm run lint && npm run build
```

6. Preview `/blog` to confirm the card is gone.

## Important Notes

- The `slug` controls the URL. Do not use spaces, apostrophes, or special characters. Use lowercase words separated by hyphens.
- The `category` value must match one of the allowed labels exactly.
- Newsletter dates are not automatic. Employees set `publishDate` and `dateLabel` manually so the visible date can always be the correct Sunday.
- For newsletters, `image.src` should always be the first page image. That is what makes the entire Blog tile look like the newsletter first page.
- If a newsletter has more or fewer pages, update the `newsletter.pages` array so it lists exactly the pages that exist.
- Always run `npm run lint && npm run build` before publishing changes.
