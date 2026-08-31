# add_flashcard

Creates flashcard sets rendered as interactive swipeable / flippable cards in
the chat pane.

| | |
|---|---|
| Class | `AddFlashcardTool` |
| Tool name | `add_flashcard` |
| Schema | [definition.json](definition.json) |
| Frontend event | `flashcard` |

## Arguments

| Field | Notes |
|---|---|
| `title` | Defaults to `"Flashcards"` |
| `cards` | List of `{front, back}` objects |

## Card sanitisation

A card is kept only if **both** `front` and `back` are non-empty. Partially
filled cards are silently dropped, so the rendered count may be lower than what
the model emitted.

## Usage

```python
from agent_tools.custom import AddFlashcardTool

tool = AddFlashcardTool()
result = tool.execute({"title": "Key Terms", "cards": [{"front": "...", "back": "..."}]})
message = tool.output(result, arguments)
```

## Notes

The `output` message reports the set title and surviving card count, and
instructs the model not to repeat the cards in text.
