import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assetPath } from "./asset-paths.mjs";
import { encode, HEADER_COLOR, HEADER_TEXT } from "./record-platform.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(await readFile(join(here, "tutorials.json"), "utf8"));
assert.equal(catalog.projectName, "Agentic Shiksha");
const style = { background: HEADER_COLOR.replace("0x", "#"), text: HEADER_TEXT.replace("0x", "#"), badge: false };
const filterPath = (value) => value.replace(/\\/g, "/").replace(/:/g, "\\:");
const font = filterPath(join(process.env.WINDIR || "C:\\Windows", "Fonts", "segoeui.ttf"));
function decodedHashes(filename, crop) {
  const output = encode(["-i", filename, ...(crop ? ["-vf", crop] : []), "-an", "-vsync", "0", "-f", "framemd5", "-"]);
  return output.split(/\r?\n/).filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(",").at(-1).trim());
}

for (const tutorial of catalog.tutorials) {
  assert(/^shiksha-[a-z-]+-tutorial$/.test(tutorial.name), "Unexpected recording filename");
  const target = (extension) => assetPath(`${tutorial.name}.${extension}`);
  const metadata = JSON.parse(await readFile(target("json"), "utf8"));
  if (JSON.stringify(metadata.headerStyle) === JSON.stringify(style)) {
    console.log(`Header already current: ${tutorial.name}`);
    continue;
  }
  const work = await mkdtemp(join(tmpdir(), "agentic-shiksha-header-"));
  const temporaryNames = new Set(["header.txt", "palette.png", "video.mp4", "video.gif", "poster.png"]);
  try {
    const crop = `crop=${metadata.width}:${metadata.height - 64}:0:64`;
    await writeFile(join(work, "header.txt"), `Agentic Shiksha  /  ${metadata.title}`);
    const filter = [
      `drawbox=x=0:y=0:w=iw:h=64:color=${HEADER_COLOR}:t=fill`,
      `drawtext=fontfile='${font}':textfile='${filterPath(join(work, "header.txt"))}':x=40:y=20:fontsize=22:fontcolor=${HEADER_TEXT}`,
    ].join(",");
    const poster = join(work, "poster.png");
    encode(["-i", target("png"), "-filter_complex_threads", "1", "-filter_complex",
      `[0:v]format=rgb24,split[head][body];[head]crop=iw:64:0:0,${filter},format=rgb24[header];[body]${crop},format=rgb24[bottom];[header][bottom]vstack=inputs=2,format=rgb24`,
      "-frames:v", "1", "-pix_fmt", "rgb24", poster]);
    assert.deepEqual(decodedHashes(poster, `${crop},format=rgb24`), decodedHashes(target("png"), `${crop},format=rgb24`),
      "Poster UI must stay pixel-identical after normalizing the PNG pixel format");
    const originalFrames = decodedHashes(target("mp4"), crop);
    assert.equal(originalFrames.length, metadata.frames);
    const mp4 = join(work, "video.mp4");
    encode(["-i", target("mp4"), "-vf", filter, "-frames:v", String(metadata.frames), "-an",
      "-c:v", "libx264", "-threads", "2", "-preset", "veryfast", "-crf", "0",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
    assert.deepEqual(decodedHashes(mp4, crop), originalFrames, "Only the external title header may change");
    const palette = join(work, "palette.png");
    encode(["-i", mp4, "-vf", "fps=10,palettegen=max_colors=192:stats_mode=diff", "-frames:v", "1", palette]);
    const gif = join(work, "video.gif");
    encode(["-i", mp4, "-i", palette, "-filter_complex_threads", "1", "-lavfi",
      "fps=10[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
      "-loop", "0", "-gifflags", "+transdiff", gif]);
    assert.equal(decodedHashes(gif).length, metadata.gifFrames);
    const bytes = await readFile(gif);
    assert.equal(bytes.readUInt16LE(6), metadata.width);
    assert.equal(bytes.readUInt16LE(8), metadata.height);
    const loop = bytes.indexOf(Buffer.from("NETSCAPE2.0"));
    assert(loop > 0 && bytes.readUInt16LE(loop + 13) === 0, "GIF loop must remain infinite");
    for (const [source, extension] of [["video.mp4", "mp4"], ["video.gif", "gif"], ["poster.png", "png"]]) {
      await copyFile(join(work, source), target(extension));
    }
    metadata.headerStyle = style;
    metadata.gifBytes = bytes.length;
    await writeFile(target("json"), JSON.stringify(metadata, null, 2) + "\n");
    console.log(`Restyled ${tutorial.name}: ${metadata.frames} frames below the header and poster UI verified pixel-identical; badge removed.`);
  } finally {
    for (const name of await readdir(work)) {
      assert(temporaryNames.has(name), `Unexpected temporary file: ${name}`);
      await unlink(join(work, name));
    }
    await rmdir(work);
  }
}
