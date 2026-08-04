import {
  addCat,
  CAT_COLORS,
  deleteCat,
  todayIso,
  updateCat,
  validateDraft,
  type CatDraft,
} from "./cats.ts";
import type { Cat, CatId, CatStore } from "./types.ts";

/**
 * The "Manage cats" dialog: roster, add/edit form, and delete confirmation.
 *
 * Uses the native `<dialog>` element, so focus trapping, Esc-to-close, the
 * backdrop, and the top layer all come for free. Kept out of `main.ts` because
 * it's a self-contained chunk of DOM glue; it owns no data of its own and
 * reaches back through `deps` for anything it needs.
 */

export interface CatsDialogDeps {
  /** Read fresh on every open — the registry changes underneath us. */
  getStore: () => CatStore;
  /** Reading keys presently attributed to a cat. Drives the delete-impact
   * count and becomes the drop list when a cat is actually deleted. */
  getReadingKeys: (catId: CatId) => string[];
  /** Persist the new registry and re-render the app. */
  onChange: (store: CatStore) => void;
}

export interface CatsDialog {
  open: () => void;
  openEdit: (catId: CatId) => void;
}

type View = "list" | "form" | "delete";

export function setupCatsDialog(deps: CatsDialogDeps): CatsDialog {
  const dialog = requireEl<HTMLDialogElement>("#cats-dialog");
  const closeBtn = requireEl<HTMLButtonElement>("#cats-dialog-close");
  const listView = requireEl<HTMLElement>("#cats-view-list");
  const formView = requireEl<HTMLFormElement>("#cats-view-form");
  const deleteView = requireEl<HTMLElement>("#cats-view-delete");
  const roster = requireEl<HTMLUListElement>("#cat-roster");
  const addBtn = requireEl<HTMLButtonElement>("#cat-add");
  const errors = requireEl<HTMLParagraphElement>("#cat-form-errors");
  const impact = requireEl<HTMLParagraphElement>("#cat-delete-impact");
  const deleteConfirm = requireEl<HTMLButtonElement>("#cat-delete-confirm");
  const saveBtn = requireEl<HTMLButtonElement>("#cat-save");

  const fields = {
    name: requireEl<HTMLInputElement>("#cat-name"),
    color: requireEl<HTMLInputElement>("#cat-color"),
    weight: requireEl<HTMLInputElement>("#cat-weight"),
    started: requireEl<HTMLInputElement>("#cat-started"),
    ended: requireEl<HTMLInputElement>("#cat-ended"),
    birthday: requireEl<HTMLInputElement>("#cat-birthday"),
    vendorPetId: requireEl<HTMLInputElement>("#cat-vendor-pet-id"),
    notes: requireEl<HTMLTextAreaElement>("#cat-notes"),
  };

  /** Cat being edited, or null when the form is adding a new one. */
  let editingId: CatId | null = null;
  let deletingId: CatId | null = null;

  function setView(view: View): void {
    listView.hidden = view !== "list";
    formView.hidden = view !== "form";
    deleteView.hidden = view !== "delete";
  }

  function renderRoster(): void {
    const { cats } = deps.getStore();
    roster.innerHTML = "";
    if (cats.length === 0) {
      const li = document.createElement("li");
      li.className = "cat-roster__empty";
      li.textContent = "No cats yet.";
      roster.appendChild(li);
      return;
    }
    for (const cat of cats) {
      roster.appendChild(rosterRow(cat));
    }
  }

  function rosterRow(cat: Cat): HTMLLIElement {
    const li = document.createElement("li");
    li.className = "cat-roster__item";

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.backgroundColor = cat.color;
    swatch.setAttribute("aria-hidden", "true");

    const text = document.createElement("div");
    text.className = "cat-roster__text";
    const name = document.createElement("strong");
    name.textContent = cat.name;
    const meta = document.createElement("span");
    meta.className = "cat-roster__meta";
    meta.textContent = rosterMeta(cat, deps.getReadingKeys(cat.id).length);
    text.append(name, meta);

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "ghost-button";
    edit.textContent = "Edit";
    edit.addEventListener("click", () => showForm(cat));

    const del = document.createElement("button");
    del.type = "button";
    del.className = "ghost-button ghost-button--danger";
    del.textContent = "Delete";
    del.addEventListener("click", () => showDelete(cat));

    li.append(swatch, text, edit, del);
    return li;
  }

  function rosterMeta(cat: Cat, readingCount: number): string {
    const parts = [`~${cat.typicalWeightKg} kg`];
    if (cat.startedAt || cat.endedAt) {
      parts.push(`${cat.startedAt ?? "…"} – ${cat.endedAt ?? "now"}`);
    }
    parts.push(`${readingCount} reading${readingCount === 1 ? "" : "s"}`);
    return parts.join(" · ");
  }

  function showForm(cat: Cat | null): void {
    editingId = cat?.id ?? null;
    errors.hidden = true;
    errors.textContent = "";
    saveBtn.textContent = cat ? "Save changes" : "Add cat";

    const { cats } = deps.getStore();
    fields.name.value = cat?.name ?? "";
    fields.color.value = cat?.color ?? nextColor(cats);
    fields.weight.value = cat ? String(cat.typicalWeightKg) : "";
    // A brand-new cat defaults to "tracked from today" so it can't retroactively
    // claim readings that belong to a cat already in the registry.
    fields.started.value = cat?.startedAt ?? (cat ? "" : todayIso());
    fields.ended.value = cat?.endedAt ?? "";
    fields.birthday.value = cat?.birthday ?? "";
    fields.vendorPetId.value = cat?.vendorPetId ?? "";
    fields.notes.value = cat?.notes ?? "";

    setView("form");
    fields.name.focus();
  }

  function showDelete(cat: Cat): void {
    deletingId = cat.id;
    const count = deps.getReadingKeys(cat.id).length;
    impact.textContent =
      count === 0
        ? `${cat.name} has no readings attributed to them, so nothing else changes.`
        : `${count} reading${count === 1 ? "" : "s"} currently attributed to ${cat.name} will be removed from the charts. This can't be undone from the app.`;
    setView("delete");
    deleteConfirm.focus();
  }

  function readDraft(): CatDraft {
    const draft: CatDraft = {
      name: fields.name.value,
      color: fields.color.value,
      typicalWeightKg: Number(fields.weight.value),
    };
    if (fields.started.value) draft.startedAt = fields.started.value;
    if (fields.ended.value) draft.endedAt = fields.ended.value;
    if (fields.birthday.value) draft.birthday = fields.birthday.value;
    if (fields.vendorPetId.value.trim()) {
      draft.vendorPetId = fields.vendorPetId.value.trim();
    }
    if (fields.notes.value.trim()) draft.notes = fields.notes.value.trim();
    return draft;
  }

  formView.addEventListener("submit", (e) => {
    e.preventDefault();
    const store = deps.getStore();
    const draft = readDraft();
    const problems = validateDraft(draft, store.cats, editingId ?? undefined);
    if (problems.length > 0) {
      errors.hidden = false;
      errors.textContent = problems.join(" ");
      return;
    }
    const next = editingId
      ? updateCat(store, editingId, draft)
      : addCat(store, draft);
    deps.onChange(next);
    renderRoster();
    setView("list");
  });

  deleteConfirm.addEventListener("click", () => {
    if (!deletingId) return;
    const store = deps.getStore();
    const next = deleteCat(store, deletingId, deps.getReadingKeys(deletingId));
    deletingId = null;
    deps.onChange(next);
    renderRoster();
    setView("list");
  });

  addBtn.addEventListener("click", () => showForm(null));

  for (const cancel of dialog.querySelectorAll<HTMLButtonElement>(
    "[data-cats-cancel]",
  )) {
    cancel.addEventListener("click", () => {
      renderRoster();
      setView("list");
    });
  }

  closeBtn.addEventListener("click", () => dialog.close());

  // Clicking the backdrop (i.e. the dialog element itself, outside its
  // content) closes — matches the override popup's click-away behaviour.
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  return {
    open: () => {
      renderRoster();
      setView("list");
      if (!dialog.open) dialog.showModal();
    },
    openEdit: (catId: CatId) => {
      const cat = deps.getStore().cats.find((c) => c.id === catId);
      renderRoster();
      if (cat) showForm(cat);
      else setView("list");
      if (!dialog.open) dialog.showModal();
    },
  };
}

/** First palette colour not already in use, so a new cat is visually distinct
 * by default. Falls back to cycling once the palette is exhausted. */
function nextColor(cats: Cat[]): string {
  const used = new Set(cats.map((c) => c.color.toLowerCase()));
  const free = CAT_COLORS.find((c) => !used.has(c.toLowerCase()));
  return free ?? CAT_COLORS[cats.length % CAT_COLORS.length];
}

function requireEl<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing required element: ${selector}`);
  return el;
}
