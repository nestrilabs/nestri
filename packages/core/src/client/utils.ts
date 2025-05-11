import type {
    Tag,
    StoreTags,
    AppDepots,
    GenreType,
} from "./types";

export namespace Utils {
    /**
   * Fetch JSON from the given URL, with Steam-like headers
   */
    export async function fetchApi<T>(url: string): Promise<T> {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "User-Agent": "Steam 1291812 / iPhone",
                "Accept-Language": "en-us",
            },
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        return (await response.json()) as T;
    }

    /**
     * Fetch a binary buffer from the given URL
     */
    export async function fetchBuffer(url: string): Promise<Buffer> {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
    }

    /**
     * Generate a slug from a name
     */
    export function createSlug(name: string): string {
        return name
            .toLowerCase()
            .replace(/[^\w\s -]/g, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .trim();
    }

    /**
     * Compute a 0–5 score from positive/negative votes
     */
    export function getRating(positive: number, negative: number): number {
        const total = positive + negative;
        if (!total) return 0;
        const avg = positive / total;
        const score = avg - (avg - 0.5) * Math.pow(2, -Math.log10(total + 1));
        return Math.round(score * 5 * 10) / 10;
    }

    export function getAssociationsByTypeWithSlug<
        T extends "developer" | "publisher"
    >(
        associations: Record<string, { name: string; type: string }>,
        type: T
    ): Array<{ name: string; slug: string; type: T }> {
        return Object.values(associations)
            .filter((a) => a.type === type)
            .map((a) => ({ name: a.name.trim(), slug: createSlug(a.name.trim()), type }));
    }

    export function compatibilityType(type?: string): string {
        switch (type) {
            case "1":
                return "low";
            case "2":
                return "mid";
            case "3":
                return "high";
            default:
                return "unknown";
        }
    }

    export function mapGameTags<
        T extends string = "tag"
    >(
        available: Tag[],
        storeTags: StoreTags,
    ): Array<{ name: string; slug: string; type: T }> {
        const tagMap = new Map<number, Tag>(available.map((t) => [t.tagid, t]));
        const result: Array<{ name: string; slug: string; type: T }> = Object.values(storeTags)
            .map((id) => tagMap.get(Number(id)))
            .filter((t): t is Tag => Boolean(t))
            .map((t) => ({ name: t.name.trim(), slug: createSlug(t.name), type: 'tag' as T }));

        return result;
    }

    /**
    * Create a tag object with name, slug, and type
    * @typeparam T Literal type of the `type` field (defaults to 'tag')
    */
    export function createTag<
        T extends string = 'tag'
    >(
        name: string,
        type?: T
    ): { name: string; slug: string; type: T } {
        const tagType = (type ?? 'tag') as T;
        return {
            name: name.trim(),
            slug: createSlug(name),
            type: tagType,
        };
    }

    export function capitalise(name: string) {
        return name
            .charAt(0) // first character
            .toUpperCase() // make it uppercase
            + name
                .slice(1) // rest of the string
                .toLowerCase();
    }

    export function getPublicDepotSizes(depots: AppDepots) {
        const sum = { download: 0, size: 0 };
        for (const key in depots) {
            if (key === 'branches' || key === 'privatebranches') continue;
            const entry = (depots as any)[key];
            if (entry?.manifests?.public) {
                sum.download += Number(entry.manifests.public.download);
                sum.size += Number(entry.manifests.public.size);
            }
        }
        return { download_size: sum.download, size_on_disk: sum.size };
    }

    export function parseGenres(str: string): GenreType[] {
        return str.split(',').map((g) => ({ type: 'genre', name: g.trim(), slug: createSlug(g) }));
    }

    export function getPrimaryGenre(
        genres: GenreType[],
        map: Record<string, string>,
        primaryId: string
    ): string | null {
        const idx = Object.keys(map).find((k) => map[k] === primaryId);
        return idx !== undefined ? genres[Number(idx)]?.name : null;
    }

    export function cleanDescription(input: string): string {
        return input.replace(/<br\s*\/?>(\s*)/g, ' ').replace(/&[a-zA-Z#0-9]+;/g, (entity) => {
            const map: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
            return map[entity] || entity;
        }).trim();
    }
}