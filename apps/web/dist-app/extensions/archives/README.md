# `common/archives`

Archive-family reference extension. The first vertical codec is ZIP: bounded structural probe,
central-directory validation, lazy namespace listing, and stored/deflate entry extraction.

ZIP parsing is local to `formats/zip`; importing another extension cannot load it.
