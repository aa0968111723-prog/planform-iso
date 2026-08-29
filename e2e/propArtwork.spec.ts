import { expect, test, type Page } from "@playwright/test";
import { openWorkspace, seedPlan, settle } from "./helpers";

/**
 * 「做一個合照背景牆，然後把剛剛匯入的那張圖貼上去」, through the real UI.
 *
 * The unit tests prove the plan and the blob id. They cannot prove a user can
 * get there: the picture has to arrive through a real file input, the sentence
 * has to reach the agent sheet, and the material in the scene has to end up
 * carrying a texture. That last step is asynchronous and happens outside the
 * store, which is exactly the part a green unit suite cannot see — the first
 * cut of this feature stored `imageBlobId` faithfully and drew nothing.
 */

/** A real 2×2 red PNG. `createImageBitmap` rejects anything that is not one. */
const RED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==",
  "base64",
);

/** 場佈 lives in the bottom nav on compact layouts and the header on desktop. */
async function gotoLayout(page: Page): Promise<void> {
  const nav = page.locator('.navbtn[data-nav="layout"]');
  if (await nav.isVisible()) await nav.click();
  else await page.locator(".group--flows button", { hasText: "場佈" }).click();
  await settle(page);
}

async function openAgent(page: Page): Promise<void> {
  await page.getByRole("button", { name: /AI/ }).first().click();
  await expect(page.locator(".agent-sheet")).toBeVisible();
}

async function ask(page: Page, text: string): Promise<void> {
  await page.locator(".agent-sheet__input").fill(text);
  await page.locator(".agent-sheet button", { hasText: "執行" }).first().click();
}

/** How many catalog entries hold an imported source image. */
function importedPictures(page: Page): Promise<number> {
  return page.evaluate(() => {
    const p = (window as unknown as {
      planform: { store: { getState(): { catalogExtras?: { blobIds?: { sourceImage?: string } }[] } } };
    }).planform.store.getState();
    return (p.catalogExtras ?? []).filter((e) => e.blobIds?.sourceImage).length;
  });
}

test.describe("貼一張真的圖到背景牆上", () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test("匯入照片 → 一句話做出背景牆並貼上 → 場景真的長出貼圖", async ({ page }) => {
    await openWorkspace(page);
    await seedPlan(page);
    await gotoLayout(page);

    // --- 1. a real picture, through the real input.
    await page
      .locator('.left input[type="file"][accept="image/*"]')
      .setInputFiles({ name: "社團合照.png", mimeType: "image/png", buffer: RED_PNG });
    await expect.poll(() => importedPictures(page), { timeout: 20_000 }).toBe(1);

    // --- 2. one sentence that both makes the backdrop and decorates it.
    await openAgent(page);
    await ask(page, "做一個合照背景牆，然後把剛剛匯入的那張圖貼上去");
    await expect(page.locator(".agent-preview-bar")).toBeVisible({ timeout: 30_000 });

    const draft = await page.evaluate(() => {
      const d = (window as unknown as {
        planform: { agent: { getDraftProject(): { props?: { name: string; parts: { imageBlobId?: string }[] }[] } | null } };
      }).planform.agent.getDraftProject();
      const props = d?.props ?? [];
      return {
        count: props.length,
        name: props.at(-1)?.name ?? "",
        pasted: props.at(-1)?.parts.filter((p) => p.imageBlobId).length ?? 0,
      };
    });
    // Exactly one backdrop — the sentence says 匯入, which used to read as a
    // second request to build one.
    expect(draft.count).toBe(1);
    expect(draft.name).toContain("背景");
    expect(draft.pasted).toBeGreaterThan(0);

    // --- 3. the blob on that face is the file we uploaded, byte for byte.
    //
    // Counting textured materials in the scene would have been the obvious
    // check and a worthless one: floor tiles and text labels already carry
    // canvas textures, so it passes whether or not the picture arrived.
    // Reading the stored bytes back cannot be fooled that way.
    await page.locator(".agent-preview-bar button", { hasText: "套用" }).first().click();
    await settle(page);

    const stored = await page.evaluate(async () => {
      const p = (window as unknown as {
        planform: { store: { getState(): { props?: { parts: { imageBlobId?: string }[] }[] } } };
      }).planform.store.getState();
      const blobId = (p.props ?? []).at(-1)?.parts.map((x) => x.imageBlobId).find(Boolean);
      if (!blobId) return { blobId: null as string | null, bytes: [] as number[], size: 0 };
      // Read IndexedDB directly rather than importing the store module: this
      // spec has to behave the same against the dev server and the built
      // preview, and only one of those can resolve a /src/ specifier.
      const rec = await new Promise<{ data: ArrayBuffer } | null>((resolve) => {
        const open = indexedDB.open("planform-assets");
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction("blobs", "readonly").objectStore("blobs").get(blobId);
          req.onerror = () => resolve(null);
          req.onsuccess = () => resolve(req.result ?? null);
        };
      });
      const view = rec ? new Uint8Array(rec.data) : new Uint8Array();
      return { blobId, bytes: [...view.slice(0, 8)], size: view.byteLength };
    });

    expect(stored.blobId).toBeTruthy();
    expect(stored.size).toBe(73);
    // PNG magic — proof this is the uploaded file and not a painted fallback.
    expect(stored.bytes).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});
