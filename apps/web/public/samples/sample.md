# Modkit MK3 sample

A served document, so the workbench has something to open on a browser that grants no
folder access.

## What it proves

- the markdown codec runs worker-brokered, like every other bundled codec
- the document's structure reaches the tree stage
- the same bytes reach the text and hex stages

| stage | contract                      |
| ----- | ----------------------------- |
| tree  | common.view/tree-data-source  |
| text  | common.view/text-data-source  |
| hex   | common.view/byte-range-source |
