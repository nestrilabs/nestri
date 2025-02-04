import { Link } from "@builder.io/qwik-city"
import { component$ } from "@builder.io/qwik"
import { MotionComponent, TitleSection, transition } from "@nestri/ui/react"

const blogs = [
    {
        title: "Navigating VMs and GPU Passthrough: Building a Better Foundation for Nestri",
        createdAt: "2024-10-26T23:28:02.584Z",
        description: "Join us as we navigate the challenges of building Nestri",
        href: "gpu-passthru"
    }
]

export default component$(() => {
    return (
        <div>
            <TitleSection client:load title="Blog" description="All the latest news from Nestri and the community." />
            <MotionComponent
                initial={{ opacity: 0, y: 100 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={transition}
                client:load
                class="flex items-center justify-center w-full"
                as="div"
            >
                <div class="px-4 w-full flex items-center justify-center">
                    <div class="w-full max-w-xl mx-auto flex flex-col">
                        {blogs.map((blog) => (
                            <Link key={blog.title} class="border-b border-gray-300 dark:border-gray-700 outline-none w-full" href={`/blog/${blog.href}`}>
                                <div class="w-full gap-3 py-6 hover:px-2 flex relative items-center rounded-md hover:bg-gray-200 dark:hover:bg-gray-800 transition-all duration-200">
                                    <div class="w-max flex flex-col max-w-[70%]">
                                        <h2 class="text-lg inline-block font-bricolage font-bold dark:text-gray-100 text-gray-800">{blog.title}</h2>
                                        <p class="text-sm text-gray-600 dark:text-gray-400 overflow-ellipsis whitespace-nowrap overflow-hidden">{blog.description}</p>
                                    </div>
                                    <div class="flex-1 relative min-w-[8px] box-border before:absolute before:-bottom-[1px] before:h-[1px] before:w-full before:bg-gray-600 dark:before:bg-gray-400 before:z-[5] before:duration-300 before:transition-all" />
                                    <p class="text-sm text-gray-600 dark:text-gray-400">{new Date(blog.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            </MotionComponent>
        </div>
    )
})