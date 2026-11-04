import { DOMParser } from "linkedom";
import { checkImageDimensions } from "../tools/learner-image-dimensions.ts";

/** Canonical static XML for the native rasterizer. The only non-fragment
 * resource permitted is one bounded, dimension-checked PNG/JPEG snapshot.
 * No generated URI may select a host file, network URL or executable SVG. */
export function validatedNativeSvg(svg: string): string {
	if (Buffer.byteLength(svg) > 3 * 1024 * 1024) throw new Error("SVG input too large.");
	if (/<!DOCTYPE|<!ENTITY|<\?/i.test(svg)) throw new Error("SVG declarations are unsupported.");
	const doc = new DOMParser().parseFromString(svg, "image/svg+xml") as unknown as Document;
	if (doc.documentElement?.localName !== "svg" || Array.from(doc.childNodes).filter((n) => n.nodeType === 1).length !== 1) {
		throw new Error("Expected one SVG document.");
	}
	const elements = Array.from(doc.querySelectorAll("*"));
	if (elements.length > 10000) throw new Error("SVG structure exceeds limits.");
	let images = 0;
	const fragment = /^#[A-Za-z_][\w:.-]*$/;
	const css = (value: string) => {
		if (/\\|@import/i.test(value)) throw new Error("Escaped or imported SVG resources are unsupported.");
		for (const match of value.matchAll(/url\s*\(([^)]*)\)/gi)) {
			if (!fragment.test(match[1]!.trim().replace(/^['"]|['"]$/g, ""))) throw new Error("External SVG resources are unsupported.");
		}
	};
	for (const element of elements) {
		const name = element.localName.toLowerCase();
		if (name.includes(":") || ["script", "foreignobject", "iframe", "animate", "animatemotion", "animatetransform", "set", "discard"].includes(name)) {
			throw new Error("Active or qualified SVG elements are unsupported.");
		}
		if (name === "style") css(element.textContent ?? "");
		for (const attr of Array.from(element.attributes)) {
			const key = attr.name.toLowerCase();
			if (/^on/.test(key) || key === "xml:base") throw new Error("Active SVG attributes are unsupported.");
			if (key === "xmlns" && attr.value !== "http://www.w3.org/2000/svg") throw new Error("Unexpected SVG namespace.");
			if (key.startsWith("xmlns:") && (key !== "xmlns:xlink" || attr.value !== "http://www.w3.org/1999/xlink")) throw new Error("SVG namespace aliases are unsupported.");
			if (key.includes(":") && !["xmlns:xlink", "xlink:href", "xml:lang", "xml:space"].includes(key)) throw new Error("Qualified SVG attributes are unsupported.");
			if (key === "href" || key === "xlink:href") {
				if (fragment.test(attr.value)) continue;
				const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(attr.value);
				if (name !== "image" || !match || ++images > 1 || match[2]!.length % 4 !== 0 || match[2]!.length > 1400000) throw new Error("External or unsupported embedded SVG resources.");
				const bytes = Buffer.from(match[2]!, "base64");
				if (bytes.length > 1024 * 1024) throw new Error("Embedded image exceeds limits.");
				const { width, height } = checkImageDimensions(bytes, match[1]!);
				if (width > 1600 || height > 1600) throw new Error("Embedded image dimensions exceed limits.");
			} else if (!key.startsWith("xmlns")) css(attr.value);
		}
	}
	if (images === 0 && Buffer.byteLength(svg) > 1024 * 1024) throw new Error("SVG input too large.");
	// Rasterize the inspected representation, avoiding disagreements between
	// XML parsers about duplicate/encoded attributes in the original input.
	return doc.toString();
}
