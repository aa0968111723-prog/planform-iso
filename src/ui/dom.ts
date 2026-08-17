export type Attrs = Record<string, string | number | boolean | undefined>;

/** Terse element factory. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "class") node.className = String(v);
    else if (k === "text") node.textContent = String(v);
    else if (k.startsWith("data-")) node.setAttribute(k, String(v));
    else if (k in node) (node as unknown as Record<string, unknown>)[k] = v;
    else node.setAttribute(k, String(v));
  }
  for (const c of children) node.append(c);
  return node;
}

export function num(
  label: string,
  value: number,
  step: number,
  onChange: (v: number) => void,
  min?: number,
): HTMLLabelElement {
  const input = el("input", { type: "number", value, step, class: "field__input" });
  if (min !== undefined) input.min = String(min);
  input.addEventListener("change", () => onChange(parseFloat(input.value)));
  const wrap = el("label", { class: "field" }, [
    el("span", { class: "field__label", text: label }),
    input,
  ]) as HTMLLabelElement;
  return wrap;
}

export function textField(
  label: string,
  value: string,
  onChange: (v: string) => void,
): HTMLLabelElement {
  const input = el("input", { type: "text", value, class: "field__input" });
  input.addEventListener("change", () => onChange(input.value));
  return el("label", { class: "field" }, [
    el("span", { class: "field__label", text: label }),
    input,
  ]) as HTMLLabelElement;
}

export function button(
  label: string,
  onClick: () => void,
  cls = "btn",
): HTMLButtonElement {
  const b = el("button", { type: "button", class: cls, text: label }) as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}

export function section(title: string, body: HTMLElement[]): HTMLDetailsElement {
  const details = el("details", { class: "section", open: true }, [
    el("summary", { class: "section__title", text: title }),
    el("div", { class: "section__body" }, body),
  ]) as HTMLDetailsElement;
  return details;
}
