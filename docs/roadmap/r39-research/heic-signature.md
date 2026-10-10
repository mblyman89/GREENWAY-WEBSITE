# HEIC signature (source: Library of Congress fdd000526, https://www.loc.gov/preservation/digital/formats/fdd/fdd000526.shtml)
- ISO BMFF: first box is ftyp; bytes 0-3 = box length (u32 BE), bytes 4-7 = "ftyp", bytes 8-11 = major brand, 12-15 minor version, then compatible brands (4 bytes each) to box length.
- IANA image/heic allowed only if conforms to heic/heix/heim/heis and contains one as a compatible brand.
- Structural brand mif1 typically first compatible brand; msf1 for sequences.
- Real examples: ftypheic....mif1miafMiHBheic (iPhone), ftypmif1....mif1heichevc (libheif), ftypheix....mif1heix (Canon), ftypmsf1....msf1hevcheicmif1iso8
Decision: accept as HEIC iff bytes 4-7 == "ftyp" and the major brand or any compatible brand (within box length, capped by bytes available) is one of heic/heix/heim/heis.
