# Demo documents (Lane B, task 9)

Three **sample cards with dummy data**, for the Journey A demo. They are not real documents and carry a red
"SAMPLE - DUMMY DATA" banner. Never put real ID photos in this repo.

| File | What it is | Dummy values |
|---|---|---|
| `sample-aadhaar.png` | Aadhaar-style card | Asha Kumari Sharma, DOB 26/01/1990, number 1234 5678 9012 |
| `sample-pan.png` | PAN-style card | Asha Kumari Sharma, father Ramesh Sharma, DOB 26/01/1990, ABCDE1234F |
| `sample-marksheet.png` | Class 10 certificate | **Radha** Sharma (a different first name on purpose), DOB 26-01-1990 |

## The demo (Journey A)
1. Open **Check my documents**, keep "New passport".
2. Add the three images (Choose file), one in each matching slot.
3. Check each field on the confirm screen and press "Yes, this is correct".
4. Press **Check my documents**: the result is "Not ready to book yet" with a name mismatch between the Aadhaar
   and the marksheet, plus a provisional warning that no address proof was added.
5. Press **Fix with Mitra**: the chat opens with a short templated note and no document values.

To show a clean run instead, fix the marksheet name to "Asha Kumari Sharma" on its confirm screen.

`.svg` files are the sources; the `.png` files are what you upload (OCR needs a raster image).
Regenerate a PNG on macOS with `qlmanage -t -s 1100 -o . <name>.svg`, then crop with
`sips --cropToHeightWidth <height> 1100 <name>.png` (700 for Aadhaar and marksheet, 840 for PAN).
