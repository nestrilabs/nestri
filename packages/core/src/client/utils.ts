import type {
    Tag,
    StoreTags,
    AppDepots,
    GenreType,
    LibraryAssetsFull,
    DepotEntry,
} from "./types";
import sharp from 'sharp';
import crypto from 'crypto';
import pLimit from 'p-limit';
import { LRUCache } from 'lru-cache';
import sanitizeHtml from 'sanitize-html';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import fetch, { RequestInit } from 'node-fetch';
import { FastAverageColor } from 'fast-average-color';

const fac = new FastAverageColor()
// --- Configuration ---
const httpAgent = new HttpAgent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 50 });
const downloadCache = new LRUCache<string, Buffer>({
    max: 100,
    ttl: 1000 * 60 * 30,      // 30-minute expiry
    allowStale: false,
});
const downloadLimit = pLimit(10); // max concurrent downloads

const DARKNESS_WEIGHT = 1.5;   // Prefer darker images (good for contrast)
const VARIETY_WEIGHT = 20;     // Strongly prefer images with color variety
const TEXT_WEIGHT = 2;         // Slightly penalize images with too much text

export namespace Utils {
    export async function fetchJson<T>(url: string): Promise<T> {
        const res = await fetch(url, { agent: (_parsed) => _parsed.protocol === 'http:' ? httpAgent : httpsAgent } as RequestInit);
        if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
        return res.json() as Promise<T>;
    }

    export async function fetchBuffer(url: string): Promise<Buffer> {
        if (downloadCache.has(url)) {
            return downloadCache.get(url)!;
        }
        const res = await fetch(url, { agent: (_parsed) => _parsed.protocol === 'http:' ? httpAgent : httpsAgent } as RequestInit);
        if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        downloadCache.set(url, buf);
        return buf;
    }

    export async function getImageMetadata(buffer: Buffer) {
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        const { width, height, format, size: fileSize } = await sharp(buffer).metadata();
        if (!width || !height) throw new Error('Invalid dimensions');

        const slice = await sharp(buffer)
            .resize({ width: Math.min(width, 256) }) // cheap shrink
            .ensureAlpha()
            .raw()
            .toBuffer();

        const pixelArray = new Uint8Array(slice.buffer);
        const { hex, isDark } = fac.prepareResult(fac.getColorFromArray4(pixelArray, { mode: "precision" }));

        return { hash, format, averageColor: { hex, isDark }, dimensions: { width, height }, fileSize, buffer };
    }

    // --- Optimized Box Art creation ---
    export async function createBoxArtBuffer(
        assets: LibraryAssetsFull,
        appid: number | string,
        logoPercent = 0.9
    ): Promise<Buffer> {
        const base = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}`;
        const pick = (key: string) => {
            const set = assets[key];
            const path = set?.image2x?.english || set?.image?.english;
            if (!path) throw new Error(`Missing asset for ${key}`);
            return `${base}/${path}`;
        };

        const [bgBuf, logoBuf] = await Promise.all([
            downloadLimit(() => fetchBuffer(pick('library_hero'))),
            downloadLimit(() => fetchBuffer(pick('library_logo'))),
        ]);

        const bgImage = sharp(bgBuf);
        const meta = await bgImage.metadata();
        if (!meta.width || !meta.height) throw new Error('Invalid background dimensions');
        const size = Math.min(meta.width, meta.height);
        const left = Math.floor((meta.width - size) / 2);
        const top = Math.floor((meta.height - size) / 2);
        const squareBg = bgImage.extract({ left, top, width: size, height: size });

        // Resize logo
        const logoTarget = Math.floor(size * logoPercent);
        const logoResized = await sharp(logoBuf).resize({ width: logoTarget }).toBuffer();
        const logoMeta = await sharp(logoResized).metadata();
        if (!logoMeta.width || !logoMeta.height) throw new Error('Invalid logo dimensions');
        const logoLeft = Math.floor((size - logoMeta.width) / 2);
        const logoTop = Math.floor((size - logoMeta.height) / 2);

        return await squareBg
            .composite([{ input: logoResized, left: logoLeft, top: logoTop }])
            .png()
            .toBuffer();
    }

    export async function simpleTextBlobCount(buffer: Buffer) {
        // 1a. Preprocess: resize, grayscale, threshold → raw 0/255 buffer
        const { data, info } = await sharp(buffer)
            .resize({ width: 300 })   // downscale for speed
            .grayscale()              // collapse color
            .threshold(180)           // tune this level
            .raw()
            .toBuffer({ resolveWithObject: true });

        // 1b. Connected-component analysis
        return countBlackBlobs(data, info.width, info.height);
    }

    /**
   * Fetch JSON from the given URL, with Steam-like headers
   */
    export async function fetchApi<T>(url: string): Promise<T> {
        const response = await fetch(url, {
            agent: (_parsed) => _parsed.protocol === 'http:' ? httpAgent : httpsAgent,
            method: "GET",
            timeout: 15_000,
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

    function countBlackBlobs(pixels: Uint8Array, w: number, h: number) {
        const seen = new Uint8Array(w * h);
        let blobs = 0;
        let totalArea = 0;

        const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
        const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

        for (let i = 0; i < w * h; i++) {
            if (pixels[i] === 0 && !seen[i]) {
                blobs++;
                let area = 0;
                const stack = [i];
                seen[i] = 1;

                while (stack.length) {
                    const idx = stack.pop()!;
                    area++;
                    const x = idx % w, y = Math.floor(idx / w);

                    for (const [dx, dy] of dirs) {
                        const nx = x + dx, ny = y + dy;
                        if (!inBounds(nx, ny)) continue;
                        const ni = ny * w + nx;
                        if (pixels[ni] === 0 && !seen[ni]) {
                            seen[ni] = 1;
                            stack.push(ni);
                        }
                    }
                }

                totalArea += area;
            }
        }

        return { blobs, totalArea };
    }

    export async function analyzeFast(buffer: Buffer, url: string) {
        const image = sharp(buffer).ensureAlpha();
        const { width, height } = await image.metadata();
        if (!width || !height) throw new Error('Invalid dimensions');

        // Extract upper 30% raw pixels
        const h = Math.floor(height * 0.7)

        const slice = await image
            .extract({ left: 0, top: 0, width, height: h })
            .raw()
            .toBuffer();

        const pixelArray = new Uint8Array(slice);
        let brightnessSum = 0;
        const seen = new Set<number>();

        // RGBA comes in groups of 4 bytes per pixel:
        for (let i = 0; i < pixelArray.length; i += 4) {
            const [r, g, b] = pixelArray.slice(i, i + 3);
            brightnessSum += (r + g + b) / 3;
            const bucket = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
            seen.add(bucket);
        }

        const count = pixelArray.length / 4; // total pixels
        const avgB = brightnessSum / count;
        const darknessScore = 255 - avgB;
        const varietyScore = seen.size / (count / 100);

        return { url, darknessScore, varietyScore, buffer };
    }

    export async function scoreBuffers(screenshots: { buffer: Buffer; url: string }[]): Promise<{ score: number; url: string }[]> {
        // 1. Fast analysis in parallel (throttled)
        const fast = await Promise.all(
            screenshots.map(s => downloadLimit(() => analyzeFast(s.buffer, s.url)))
        );

        // 2. Keep top 10 by fast score
        const top = fast
            .map(f => ({ ...f, fastScore: f.darknessScore + f.varietyScore }))
            .sort((a, b) => b.fastScore - a.fastScore)
            .slice(0, 10);

        // 3. Return all results with their scores
        const results = await Promise.all(
            top.map(async (item) => {
                const { blobs, totalArea } = await simpleTextBlobCount(item.buffer);

                // Example scoring: fewer blobs → higher score
                // you can also factor in totalArea if you like
                const textScore = -blobs;
                return {
                    item, textScore, blobs, totalArea
                }
            })
        );

        const final = top.map((t, i) => ({ score: t.darknessScore * DARKNESS_WEIGHT + t.varietyScore * VARIETY_WEIGHT + results[i].textScore * TEXT_WEIGHT, url: t.url }));

        return final.sort((a, b) => b.score - a.score);
    }

    // --- Helpers for URLs ---
    export function getScreenshotUrls(screenshots: { appid: number; filename: string }[]): string[] {
        return screenshots.map(s => `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${s.appid}/${s.filename}`);
    }

    export function getAssetUrls(assets: LibraryAssetsFull, appid: number | string, header: string) {
        const base = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}`;
        return {
            logo: `${base}/${assets.library_logo?.image2x?.english || assets.library_logo?.image?.english}`,
            backdrop: `${base}/${assets.library_hero?.image2x?.english || assets.library_hero?.image?.english}`,
            poster: `${base}/${assets.library_capsule?.image2x?.english || assets.library_capsule?.image?.english}`,
            banner: `${base}/${assets.library_header?.image2x?.english || assets.library_header?.image?.english || header}`,
        };
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

    export function compatibilityType(type?: string): "low" | "mid" | "high" | "unknown" {
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
            const entry = depots[key] as DepotEntry;
            if ('manifests' in entry && entry.manifests.public) {
                sum.download += Number(entry.manifests.public.download);
                sum.size += Number(entry.manifests.public.size);
            }
        }
        return { downloadSize: sum.download, sizeOnDisk: sum.size };
    }

    export function parseGenres(str: string): GenreType[] {
        return str.split(',')
            .map((g) => g.trim())
            .filter(Boolean)
            .map((g) => ({ type: 'genre', name: g.trim(), slug: createSlug(g) }));
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
        
        const cleaned = sanitizeHtml(input, {
            allowedTags: [],         // no tags allowed
            allowedAttributes: {},   // no attributes anywhere
            textFilter: (text) => text.replace(/\s+/g, ' '), // collapse runs of whitespace
        });

        return cleaned.trim()
    }
}