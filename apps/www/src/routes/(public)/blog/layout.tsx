import { $, component$, Slot, useOnDocument, useStyles$ } from "@builder.io/qwik";
import { useContent } from "@builder.io/qwik-city";
import { Footer } from "@nestri/ui";
import styles from "./blog.css?inline"
import { Link, useDocumentHead, useLocation } from "@builder.io/qwik-city";

function getDaysAgo(date: Date): string {
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays === 1 ? '(1 day ago)' : `(${diffDays} days ago)`;
}

export default component$(() => {
    useStyles$(styles)
    const isBlogPost = useLocation().url.pathname.startsWith("/blog/")
    const { frontmatter } = useDocumentHead()
    const { headings } = useContent();

    useOnDocument('load', $(() => {
        const sections = document.querySelectorAll('.blog h2');
        const tocLinks = document.querySelectorAll('#toc a');

        const observerOptions = {
            threshold: 0.5
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const id = entry.target.getAttribute('id');
                    tocLinks.forEach(link => {
                        link.classList.remove('active');
                        if (link.getAttribute('href') === `#${id}`) {
                            link.classList.add('active');
                        }
                    });
                }
            });
        }, observerOptions);

        sections.forEach(section => observer.observe(section));
    }))

    return (
        <>
            {
                isBlogPost ?
                    (
                        <div class="gap-8 w-full sm:grid flex relative sm:grid-cols-[1fr_auto_1fr] items-center justify-center px-4 py-20 pb-10">
                            <div class="hidden sm:block h-full">
                                <nav class="sticky top-20 z-10 w-full flex flex-col justify-center px-8 items-end gap-8">
                                    <Link href="/blog" class="flex w-max justify-center gap-1 items-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100">
                                        <svg width="18px" height="18px" stroke-width="1.5" viewBox="0 0 24 24" fill="none" color="currentColor"><path d="M10.25 4.75l-3.5 3.5 3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path><path d="M6.75 8.25h6a4 4 0 014 4v7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path></svg>
                                        Blog
                                    </Link>
                                </nav>
                            </div>
                            <div class="max-w-xl mx-auto w-full gap-1 flex flex-col">
                                <h2 class="text-4xl text-start tracking-tight font-bold font-bricolage">
                                    {frontmatter.blogTitle}
                                </h2>
                                <div class="list-none flex flex-col items-start justify-start mt-2 gap-2 text-sm w-full">
                                    <span class="text-base dark:text-neutral-400 text-neutral-600 text-nowrap flex flex-row w-full items-center overflow-ellipsis">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="size-5 mr-1" width="32" height="32" viewBox="0 0 24 24">
                                            <g fill="none" fill-rule="evenodd">
                                                <path d="M24 0v24H0V0zM12.594 23.258l-.012.002l-.071.035l-.02.004l-.014-.004l-.071-.036q-.016-.004-.024.006l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.016-.018m.264-.113l-.014.002l-.184.093l-.01.01l-.003.011l.018.43l.005.012l.008.008l.201.092q.019.005.029-.008l.004-.014l-.034-.614q-.005-.018-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.003-.011l.018-.43l-.003-.012l-.01-.01z" />
                                                <path fill="currentColor" d="M6 7a5 5 0 1 1 10 0A5 5 0 0 1 6 7m5-3a3 3 0 1 0 0 6a3 3 0 0 0 0-6M4.413 17.601c-.323.41-.413.72-.413.899c0 .118.035.232.205.384c.197.176.55.37 1.11.543c1.12.346 2.756.521 4.706.563a1 1 0 1 1-.042 2c-1.997-.043-3.86-.221-5.254-.652c-.696-.216-1.354-.517-1.852-.962C2.347 19.906 2 19.274 2 18.5c0-.787.358-1.523.844-2.139c.494-.625 1.177-1.2 1.978-1.69C6.425 13.695 8.605 13 11 13q.671 0 1.316.07a1 1 0 0 1-.211 1.989Q11.564 15 11 15c-2.023 0-3.843.59-5.136 1.379c-.647.394-1.135.822-1.45 1.222Zm16.8-3.567a2.5 2.5 0 0 0-3.536 0l-3.418 3.417a1.5 1.5 0 0 0-.424.849l-.33 2.308a1 1 0 0 0 1.133 1.133l2.308-.33a1.5 1.5 0 0 0 .849-.424l3.417-3.418a2.5 2.5 0 0 0 0-3.535Zm-2.122 1.414a.5.5 0 0 1 .707.707l-3.3 3.3l-.825.118l.118-.825z" /></g>
                                        </svg>
                                        {frontmatter.authors?.map((author: any, index: number) => (
                                            <>
                                                &nbsp;
                                                <Link href={author.link} target="_blank" class="underline underline-offset-4 hover:text-gray-900 dark:hover:text-gray-100" key={author.name}>
                                                    {author.name}
                                                </Link>
                                                &nbsp;
                                                {index < frontmatter.authors.length - 2 && ', '}
                                                {index === frontmatter.authors.length - 2 && (frontmatter.authors.length > 2 ? ', and ' : ' and ')}
                                            </>
                                        ))}
                                    </span>
                                    <span class="text-base dark:text-neutral-400 items-center flex flex-row w-full overflow-ellipsis text-neutral-600 text-nowrap">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="size-5 mr-1" width="32" height="32" viewBox="0 0 24 24"><path fill="currentColor" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8s8 3.58 8 8s-3.58 8-8 8m-.22-13h-.06c-.4 0-.72.32-.72.72v4.72c0 .35.18.68.49.86l4.15 2.49c.34.2.78.1.98-.24a.71.71 0 0 0-.25-.99l-3.87-2.3V7.72c0-.4-.32-.72-.72-.72" /></svg>
                                        &nbsp;
                                        {new Date(frontmatter.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                                        &nbsp;
                                        {getDaysAgo(new Date(frontmatter.createdAt))}
                                    </span>
                                </div>
                                <img src={frontmatter.thumbnail} alt={frontmatter.title} width={680} height={400} class="w-full aspect-video ring-2 ring-neutral-300 dark:ring-neutral-700 rounded-lg object-cover mt-4" />                        <p class="text-sm text-gray-600 dark:text-gray-400">{frontmatter.date}</p>
                                <div class="mt-10 gap-4 prose dark:prose-invert flex flex-col blog">
                                    <Slot />
                                </div>
                            </div>
                            <div class="hidden sm:block h-full">
                                <nav class="sticky top-20 z-10 w-full flex justify-center items-center">
                                    <ul id="toc" class="list-none p-0 m-0 flex flex-col items-start justify-start gap-1">
                                        {headings?.map((heading) => (
                                            <li key={heading.id} class="text-sm text-gray-600 dark:text-gray-400 relative transition-all duration-200">
                                                <a href={`#${heading.id}`} class="flex flex-row items-center ml-4 gap-2 overflow-ellipsis text-nowrap hover:text-gray-900 dark:hover:text-gray-100">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 absolute left-0 hidden group-hover:block" width="32" height="32" viewBox="0 0 24 24"><path fill="currentColor" d="m7 6l-.112.006a1 1 0 0 0-.669 1.619L9.72 12l-3.5 4.375A1 1 0 0 0 7 18h6a1 1 0 0 0 .78-.375l4-5a1 1 0 0 0 0-1.25l-4-5A1 1 0 0 0 13 6z" /></svg>
                                                    {heading.text}
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                </nav>
                            </div>
                        </div>
                    )
                    : <Slot />
            }
            <Footer />
        </>
    );
});