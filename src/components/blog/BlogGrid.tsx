import { BlogCard } from "@/components/blog/BlogCard";
import type { BlogPost } from "@/lib/blog/posts";

type BlogGridProps = {
  posts: BlogPost[];
  /** Owner-editable "Read article" button label (SLICE 115). */
  readMoreLabel?: string;
};

export function BlogGrid({ posts, readMoreLabel }: BlogGridProps) {
  return (
    <div className="grid gap-5 md:gap-6 lg:grid-cols-3 xl:gap-8">
      {posts.map((post) => (
        <BlogCard key={post.slug} post={post} readMoreLabel={readMoreLabel} />
      ))}
    </div>
  );
}
