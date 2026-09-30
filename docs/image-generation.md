# Image generation in Agentic Shiksha

**Turn a course question into an illustration, inspect it, and keep learning in
the same conversation.**

[Documentation](README.md) / [Course Teaching Assistant](agents/course-ta.md) /
[All video demos](../assets/web/motion/demos.html)

**Source snapshot: 2026-09-30; Unreleased.** Availability depends on the selected
course TA's tools and the backend's image-model and storage configuration. This
guide describes implemented behavior, not a verified live deployment.

## Watch the feature

![Image-generation walkthrough: four starters, an illustration request, the loading state, a full-size preview and a follow-up question](../assets/images/motion/shiksha-image-generation-tutorial.gif)

**[Download MP4 - 35 seconds](../assets/web/motion/shiksha-image-generation-tutorial.mp4?raw=1)**
 / [Animated GIF](../assets/images/motion/shiksha-image-generation-tutorial.gif)
 / [Still preview](../assets/images/motion/shiksha-image-generation-tutorial.png)
 / [Captions](../assets/web/motion/shiksha-image-generation-tutorial.vtt)
 / [Local gallery player](../assets/web/motion/demos.html#image-generation)

The demo uses the **actual Agentic Shiksha interface**. It shows four conversation
starters, requests a solar-irrigation illustration, displays **Generating image**,
opens the native full-size preview, and asks how light becomes motion and water
flow. The recording collapses the left navigation before the image appears.

**The image and responses in this recording are synthetic.** The illustration is
original local SVG artwork delivered through a simulated tool response; no live
image model, cloud quota or real learner record was used. The 35-second duration
is an edited instructional timeline, not an image-generation latency benchmark.
See [how the demo was recorded](../assets/web/motion/README.md#image-generation).

GitHub displays the GIF inline. For play/pause and seeking, download the MP4 or
open the gallery from a local checkout; a repository-relative MP4 link is not a
native GitHub video embed.

## What the feature does

The selected **course TA** can call the `generate_image` tool to create an image
from a text description. This is a tool of the TA, **not a separate Image Agent**.
It can support explanations with illustrations, annotated scenes and visual
examples when a picture adds something useful to the lesson.

- A loading placeholder appears while the image is being prepared.
- The result and explanatory caption appear inline in the conversation.
- Clicking the image opens a larger preview; the close control returns to chat.
- A follow-up can ask the TA to explain the represented concepts or assumptions.

The implemented tool requests **one 1536 x 1024 landscape image** per call.
Its quality values are `low` and `medium`, supplied by the TA's tool call; this
guide does not imply a dedicated quality or image-size picker in the chat UI.
See the [tool contract](<../Agentic Shiksha Platform/Backend/agent_tools/custom/generate_image/README.md>).

## Try it in a course

1. Open **Library**, choose a course TA that has image generation available, and
   select **Start Chat**.
2. Describe the subject, the labels that matter and the relationships you want
   illustrated. Keep the request tied to the course.
3. Send the request and wait for the image. Tool selection is performed by the
   TA; a text prompt is not a guarantee that it will call the image tool.
4. Collapse the sidebar if you want more room, then click the image to inspect
   the preview.
5. Check the labels and relationships against the lesson. Close the preview and
   ask a focused follow-up.

### Example request

> Create a labeled illustration of solar-powered irrigation. Show "Sunlight"
> reaching "Solar panels"; show electrical energy going from the panels to a
> "Motor + pump"; show water moving from a water source through the pump to
> "Irrigated crops". Distinguish the electrical-energy path from the water-flow
> path. Use a clear educational style, a short caption and generous margins.
> Make this a conceptual illustration, not a wiring diagram.

Then ask:

> Explain how light becomes motion and moves water in this picture. Which
> details are simplified, and where would a real system lose energy?

For another topic, provide the same three kinds of information:

| Prompt layer | What to specify |
| --- | --- |
| Exact content | Write essential labels, values, formulas and legend text explicitly, preferably in quotes. |
| Structure | State where elements belong, which direction each arrow goes and what each connection represents. |
| Presentation | Choose a readable style, palette and viewpoint, with space around labels and all four edges. |

**Treat the image model as a renderer, not a source of scientific authority.**
Generated labels and relationships can be wrong even when the picture looks
convincing. Use verified course material to specify the content, review the
output, and explain uncertain details in words rather than inventing them.
Viewing an image or receiving an explanation is not evidence of learner mastery.

## How it works

| Stage | Current implementation |
| --- | --- |
| Tool selection | The course TA requests `generate_image` with a visual prompt, title and quality; a caption is encouraged by the tool instructions. |
| Generation | The tool checks configuration and allowance, then calls the configured image deployment through the OpenAI-compatible `images/generations` API. |
| Streaming | The harness sends `generated_image_start`, followed by a `generated_image` result containing the image, caption and metadata. |
| Display | The frontend renders the loading state, inline image and native preview. Live responses can carry base64 PNG data; restored messages use the saved image URL. |
| Persistence | The tool attempts to upload the PNG to Blob Storage. Conversation persistence retains its reference rather than treating a large inline payload as durable image storage. |

These responsibilities are grounded in the [image tool][tool],
[tool dispatch][dispatch], [stream event mapping][events],
[image renderer][renderer] and [chat synchronization][sync].
The demo tests the interface and intercepted request/response contracts, not the
live provider or storage stages.

## Availability, quotas and failure behavior

- **Configuration:** the backend uses `AZURE_IMAGE_MODEL` and
  `GENERATED_IMAGES_CONTAINER`. `AZURE_IMAGE_ENDPOINT` can override the image
  endpoint; otherwise the tool uses `AZURE_FOUNDRY_ENDPOINT`. Storage uses
  `STORAGE_ACCOUNT_NAME`. These are server settings, not browser secrets. Follow
  [installation](../INSTALL.md) and the [typed settings][settings]; do not infer
  a deployed model name from the demo or an older source comment.
- **Allowance:** the [quota helper][quota] tracks usage per user, course agent
  and quality, with a Monday UTC weekly boundary. Code defaults are 15 low and
  5 medium images, but administrators can change the configured limits.
  These are not a promise of your deployment's available allowance.
- **Not a strict cost guarantee:** missing identity and some metering-exception
  paths can bypass quota enforcement. The source audit records these limits;
  no stronger enforcement claim is made here.
- **Generation failure:** missing setup, exhausted allowance, provider errors
  or an empty result can prevent image creation. The tool returns failure
  information and tells the TA to describe the visual verbally instead.
  Allowance is consumed before generation; a failed request or a retry can
  therefore have a cost. There is no guaranteed refund or exactly-once retry.
- **Storage failure:** a picture may appear during the current turn even when
  upload or URL signing fails. Seeing pixels is not proof that the image will
  reopen later. Do not describe the preview as a confirmed durable save.
- **Review and privacy:** use course-appropriate prompts and avoid personal or
  confidential information. Real generation contacts the configured provider;
  the offline demo does not. Neither speed nor output accuracy is guaranteed.

For the broader permission and failure contracts, see the
[chat/tool workflow audit](workflows/main-domains.md#domain-chat-turn) and
[image/document UI workflow](workflows/main-ui.md#ui-documents-images).

## Reproduce or reuse the demo

The [recording guide](../assets/web/motion/README.md#image-generation) contains
the isolated-frontend setup and exact `image-generation` recording commands.
Use its `--tutorials-only` publishing option to avoid regenerating unrelated
artwork or existing videos.

The [recording recipe](../assets/web/motion/image-generation-demo.mjs) checks
the loading state, image dimensions, preview, collapsed navigation, follow-up
conversation identity and image reference in the intercepted sync request.
Its [verification metadata](../assets/web/motion/shiksha-image-generation-tutorial.json)
records the six chapters, image hash and zero live model calls.

[tool]: <../Agentic Shiksha Platform/Backend/agent_tools/custom/generate_image/__init__.py>
[dispatch]: <../Agentic Shiksha Platform/Backend/harness/dispatch.py>
[events]: <../Agentic Shiksha Platform/Backend/harness/events.py>
[renderer]: <../Agentic Shiksha Platform/Frontend/src/features/chat/ChatBubble.tsx>
[sync]: <../Agentic Shiksha Platform/Frontend/src/lib/useChatSync.ts>
[settings]: <../Agentic Shiksha Platform/Backend/deployment_settings.py>
[quota]: <../Agentic Shiksha Platform/Backend/azure_services/persistence/image_quota.py>
