# 02 — Authoritative Specification (VERBATIM, PINNED)

Generated 2026-09-15 23:59Z by `build_spec_part.py` from the LCB documents saved under `/workspace/lcb/`.
This part is **transcription, not interpretation**. Interpretation lives in Parts 04–09 and must cite this part by `L####` pin.

## 0. How to cite from this part

- Cite as `[G L0124]` (Upload User Guide, guide.txt line 124), `[FAQ L0039]`, `[API L####]`, `[LOGIN L####]`, `[ADMIN L####]`, `[SAW L####]`, `[MANI L####]`, `[TPL Inventory R4]` (template file, row 4).
- The Upload User Guide PDF is `lcb/guide-2026-02.pdf` (`CCRS Upload User Guide 2-26 word.pdf` from https://lcb.wa.gov/ccrs/resources). `guide.txt` is `pdftotext -layout` output; page → first CONTENT line map (footer Page N is the LAST line of page N; derived from the footers, not hand-typed):

| Page | First line | Page | First line |
|---|---|---|---|
| p.2 | L1 | p.3 | L31 |
| p.4 | L76 | p.5 | L105 |
| p.6 | L153 | p.7 | L182 |
| p.8 | L209 | p.9 | L254 |
| p.10 | L297 | p.11 | L316 |
| p.12 | L358 | p.13 | L383 |
| p.14 | L428 | p.15 | L474 |
| p.16 | L522 | p.17 | L568 |
| p.18 | L614 | p.19 | L648 |
| p.20 | L694 | p.21 | L741 |
| p.22 | L787 | p.23 | L798 |
| p.24 | L843 | p.25 | L865 |
| p.26 | L909 | p.27 | L950 |
| p.28 | L969 | p.29 | L1014 |
| p.30 | L1048 | p.31 | L1093 |
| p.32 | L1139 | p.33 | L1158 |
| p.34 | L1204 | p.35 | L1251 |
| p.36 | L1263 | p.37 | L1309 |
| p.38 | L1356 | p.39 | L1403 |
| p.40 | L1427 | p.41 | L1471 |

- Pages 19–29 (Plant, PlantTransfer, PlantDestruction, LabTest, Manifest) are producer/processor/lab files. Retailers do not file them (Table 1, p.3). They are intentionally NOT transcribed here; consult `lcb/guide.txt` L648-L1047 if ever needed.
- RULE: if a future agent finds a newer guide on the Resources page, re-download, regenerate this part, and diff. Do not hand-edit this file.

## 1. CCRS Upload User Guide — retailer-relevant pages, verbatim

#### 1.0 Pages 1–2 — Title and table of contents

Source: `lcb/guide.txt` L1-L30 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0001| Cannabis Central Reporting System:
L0002| Upload User Guide
L0003| 
L0004| 
L0005| 
L0006| 
L0007| CIB 133 2/26
L0008| <PAGEBREAK>Table of Contents
L0009| Submitting Data: General Information ............................................................................. 3
L0010| File Dependencies and Order of Operations.................................................................... 4
L0011| Example Upload Workflow............................................................................................... 5
L0012| Instructions for Uploading All .CSV Files ......................................................................... 6
L0013| Common File Attributes: Header ..................................................................................... 7
L0014| Common File Attributes: Data Fields ............................................................................... 8
L0015| Area File .......................................................................................................................... 9
L0016| Strain File ...................................................................................................................... 11
L0017| Product File ................................................................................................................... 13
L0018| Inventory File ................................................................................................................. 16
L0019| Plant File ....................................................................................................................... 19
L0020| Harvest File ................................................................................................................... 23
L0021| Plant Destruction File .................................................................................................... 25
L0022| Plant Transfer File ......................................................................................................... 28
L0023| Inventory Transfer File ................................................................................................... 33
L0024| Sale File......................................................................................................................... 36
L0025| Sale File: Required Data Fields ..................................................................................... 40
L0026| 
L0027| 
L0028| 
L0029| 
L0030| Washington State Liquor and Cannabis Board CCRS Upload User Guide                                                            Page 2
```

#### 1.1 Page 3 — Introduction, upload steps 1–8, Table 1 (which files each licensee type files)

Source: `lcb/guide.txt` L31-L75 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0031| <PAGEBREAK>         Submitting Data: General Information
L0032|          1. Licensees and labs are required to upload files into CCRS to provide, maintain, and update
L0033|             all data reporting obligations (such as plant tags, inventory, sales, etc.).
L0034|          2. A licensee can assign an integrator to assist in the upload process. For more information,
L0035|             please visit the CCRS Integrator page on the LCB website.
L0036|                  • These instructions are intended for those who are uploading directly to CCRS, and
L0037|                      are not applicable for licensees working with an integrator that uploads on their
L0038|                      behalf.
L0039|          3. .CSV templates for each upload type are provided on the CCRS Resources page.
L0040|          4. The information in the files has dependencies on other data, creating an order of operations
L0041|             shown in Figure 1 on the next page.
L0042|          5. Make sure to save the data as a .CSV file with the proper naming convention for the
L0043|             appropriate report before attempting to upload the file to CCRS.
L0044|                  • The naming convention for uploaded reports are as follows, using the respective
L0045|                      upload file type name:
L0046|                            o Licensees: UploadType_LicenseNumber_YYYYMMDDHHMMSS
L0047|                            o Integrators: UploadType_IntegratorID_YYYYMMDDHHMMSS
L0048|          6. To upload .CSV files, log in to CCRS https://cannabisreporting.lcb.wa.gov/.
L0049|                  • To log in, follow the instructions in the Getting Started and Login Guide available on the
L0050|                      CCRS Resources Page.
L0051|          7. If there is an error with your file upload, you will receive an email notifying you of the error.
L0052|          8. For information on the transportation manifest, please visit the Manifest page on the LCB
L0053|             website.
L0054| 
L0055|          Reporting Responsibilities
L0056| 
L0057| Report                       Producers Processors         Producer   Retail Labs             Coops
L0058|                              Only      Only               Processors                         (If choosing to use
L0059|                                                                                              CCRS)
L0060| Area                      ■             ■                 ■              ■                   ■
L0061| Inventory                 ■             ■                 ■              ■                   ■
L0062| InventoryAdjustment       ■             ■                 ■              ■                   ■
L0063| InventoryTransfer         ■             ■                 ■              ■                   ■
L0064| LabTest                                                                           ■
L0065| Harvest                   ■                               ■
L0066| Plant                     ■                               ■                                  ■
L0067| PlantDestruction          ■                               ■                                  ■
L0068| PlantTransfer             ■                               ■                                  ■
L0069| Product                   ■             ■                 ■              ■        ■          ■
L0070| Sale                      ■             ■                 ■              ■                   ■
L0071| Strain                    ■             ■                 ■              ■                   ■
L0072|        Table 1. Reports required per licensee type
L0073| 
L0074| 
L0075|          Washington State Liquor and Cannabis Board CCRS Upload User Guide                             Page 3
```

#### 1.2 Page 4 — Upload groups / dependency order (Group 1 → 10 min → Group 2 → Group 3) and workflow steps 1–8

Source: `lcb/guide.txt` L76-L104 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0076| <PAGEBREAK>File Dependencies and Order of Operations
L0077| When uploaded into CCRS, data files are validated. Some of the validations are based on files
L0078| that have already been uploaded. The order dependency is based on the “plant to purchase”
L0079| cannabis lifecycle.
L0080| 
L0081| Because of this order-dependent validation, certain CCRS .CSV files will fail if the prerequisite
L0082| data has not been uploaded. The graphic below shows the order of operations for file uploads,
L0083| with respect to the data validation dependencies.
L0084|     • Group 1 file uploads are the Strain, Area, and Product records.
L0085|            o They are required for the Group 2 files.
L0086|     • Group 2 file uploads are the Inventory and Plant records.
L0087|            o Inventory is dependent on Strain, Area, and Product files.
L0088|            o Plant is dependent on Strain and Area files.
L0089|     • Group 3 file uploads are the Inventory Transfer, Inventory Adjustment, Harvest,
L0090|         Plant Transfer, Plant Destruction, Lab Test and Sale.
L0091|            o Inventory Transfer and Inventory Adjustment are dependent on Inventory files.
L0092|            o Plant Transfer and Plant Destruction are dependent on Plant files.
L0093|            o Lab Test is dependent on Inventory submitted by the licensee requesting the test.
L0094|            o Harvest is dependent on Inventory and Plant files.
L0095|            o Sale is dependent on Inventory OR Plant files.
L0096| 
L0097| 
L0098| 
L0099| 
L0100| Figure 1. File dependencies and order of operations for CCRS file uploads
L0101| 
L0102| 
L0103| 
L0104| Washington State Liquor and Cannabis Board CCRS Upload User Guide                         Page 4
```

#### 1.3 Page 5 — Workflow steps (cont.) incl. retailer step 9/10 and the 'receiving licensee submits inventory transfer' rule

Source: `lcb/guide.txt` L105-L152 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0105| <PAGEBREAK>Example Upload Workflow
L0106| This demonstrates a potential path that cannabis can take in its seed-to-sale lifetime.
L0107| 
L0108|    1. A plant is grown from a seed or clone (new grower, claiming new strain upon forming) –
L0109|        the producer has not uploaded the strain via a strain yet.
L0110|    2. The new plant’s strain is created (via a strain file upload), an area is created for this new
L0111|        plant (via an area file upload).
L0112|            o There are cases where it is appropriate to include plants in the product file
L0113|                upload, such as when they are propagation material. In these cases, it is a
L0114|                reporting requirement, but not a file dependency.
L0115|    3. A plant file is uploaded to register the plant - i.e., to provide the unique plant tag ID.
L0116|            o Plants can be sold as a plant or plant transfer by receiver, or sale by the seller.
L0117|            o For medical plant sales, contact the LCB examiner unit for the process.
L0118|    4. When harvested, the plant tag is updated to show as harvested or drying, the harvested
L0119|        materials become new inventory lots, and a harvest report is submitted with both plant
L0120|        tag and inventory lot information.
L0121|    5. The harvested material is sold as flower lot to processor.
L0122|            o Sale, inventory and inventory adjustment files uploaded by seller, and inventory
L0123|                and inventory transfer files uploaded by receiver.
L0124|            o It is vital that the receiver upload an inventory transfer file if they are going to
L0125|                change the original external ID of the item, and thus provide both the new ID and
L0126|                the original ID of each product or inventory item. Only the receiving licensee
L0127|                should submit an inventory transfer report, as typically only the receiving licensee
L0128|                would know what the new external ID is for the inventory.
L0129|            o Any transportation of product must be accompanied by a manifest file. For
L0130|                information on the transportation manifest, refer to the manifest documentation
L0131|                on the Manifest web page.
L0132|            o The processor must have area set up, and must upload a product file.
L0133|    6. The processor converts the flower product to the end product (creating new product of
L0134|        usable flower or concentrate via a product, inventory adjustment and inventory file
L0135|        uploads).
L0136|    7. The processor creates an inventory entry for the new products (this must be done before
L0137|        testing).
L0138|    8. End product creators require lab tests. There must be an accompanying manifest file for
L0139|        any transportation of product and the lab must send containers back to the processor.
L0140|    9. When end products are sold to the retailer:
L0141|            o A sale file is uploaded by the processor and updates inventory to match new on
L0142|                hand quantity.
L0143|            o The retailer uploads a product to create a product, inventory and inventory
L0144|                transfer files. There must be an accompanying manifest file for any transportation
L0145|                of product.
L0146|    10. The product is sold to the public (sale and inventory files - no inventory adjustment file is
L0147|        needed for end product sales).
L0148| 
L0149| 
L0150| 
L0151| 
L0152| Washington State Liquor and Cannabis Board CCRS Upload User Guide                            Page 5
```

#### 1.4 Page 6 — Portal upload UI

Source: `lcb/guide.txt` L153-L181 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0153| <PAGEBREAK>Instructions for Uploading All .CSV Files
L0154| 
L0155|    1. Please follow the steps below once you have logged into CCRS, authenticated with
L0156|       SecureAccess Washington (SAW) as detailed in the SAW User Guide on the CCRS
L0157|       Resources page.
L0158|              o Load the file by selecting the “Browse” button
L0159| 
L0160| 
L0161| 
L0162| 
L0163|        Figure 2. CCRS file upload screenshot - “Browse”
L0164| 
L0165|    2. Using the prompt from your browser and operating system (screenshot omitted since it is
L0166|       system-specific), select one or multiple files to be uploaded from your stored location.
L0167|          o Note: Only load .CSV files, all other file types will fail. Only use the applicable
L0168|              template file for your upload type, located on the CCRS Resources Page. Do not
L0169|              add/remove columns.
L0170| 
L0171|    3. Select the “Upload” button
L0172| 
L0173| 
L0174| 
L0175| 
L0176|        Figure 3. CCRS file upload screenshot - “Upload”
L0177| 
L0178| 
L0179| 
L0180| 
L0181| Washington State Liquor and Cannabis Board CCRS Upload User Guide                      Page 6
```

#### 1.5 Page 7 — File header (SubmittedBy / SubmittedDate / NumberRecords)

Source: `lcb/guide.txt` L182-L208 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0182| <PAGEBREAK>Common File Attributes: Header
L0183| All upload files types contain a set of common attributes and data fields, called the file header.
L0184| 
L0185| 
L0186| 
L0187| 
L0188| Figure 4. Example .CSV File Header
L0189| 
L0190| All files contain a header with:
L0191| 
L0192| SubmittedBy:
L0193| This field indicates the user who is submitting the report. Example: John Doe
L0194| Data Field Type (character limit): Text (35)
L0195| Required for operation type: Insert, Update and Delete
L0196| 
L0197| SubmittedDate
L0198| The date the user is submitting the records. Type: Date (MM/DD/YYYY)
L0199| Required: Insert, Update and Delete
L0200| 
L0201| NumberRecords
L0202| The number of records listed below the field names.
L0203| Note: This number must match the number of records or the file will fail to process.
L0204| 
L0205| 
L0206| 
L0207| 
L0208| Washington State Liquor and Cannabis Board CCRS Upload User Guide                             Page 7
```

#### 1.6 Page 8 — Common fields (ExternalIdentifier, CreatedBy/Date, UpdatedBy/Date, Operation)

Source: `lcb/guide.txt` L209-L253 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0209| <PAGEBREAK>Common File Attributes: Data Fields
L0210| Nearly all files contain these data fields.
L0211| 
L0212| LicenseNumber
L0213| The six-digit licensee ID number established by the State of Washington upon licensing of a
L0214| facility.
L0215|      Note: Labs have a 10-digit ID number.
L0216|      • Data Field Type: Numeric (6)
L0217|      • Required: Insert, Update and Delete
L0218|      • Valid Values: Six-digit licensee number or 10-digit lab number
L0219| ExternalIdentifier
L0220| The external identifier is an alpha-numeric identification assigned by the licensee (or integrator).
L0221| This must be unique for each row.
L0222|      Note: This field is used to identify a variety of information, including plants, product or data in
L0223|      other files, such as the InventoryExternalIdentifier field on the LabTest.CSV file.
L0224|      • Data Field Type (character limit): Text (100)
L0225|      • Required: Insert, Update and Delete
L0226| CreatedBy
L0227| Each record provides a CreatedBy field to enter the user who initially created the file.
L0228|      • Data Field Type (character limit): Text (35)
L0229| CreatedDate
L0230| Each record provides a CreatedDate field to enter the date that the file was first submitted.
L0231|      • Data Field Type: Date (MM/DD/YYYY)
L0232|                Error Messages:
L0233|                   Created Date cannot be a date past submission date for Insert.
L0234| UpdatedBy
L0235| Each record provides an UpdatedBy field to enter the user who subsequently updated a file.
L0236|      • Data Field Type (character limit): Text (35)
L0237| UpdatedDate
L0238| Each record provides an UpdatedDate field to enter the date that the file was modified.
L0239|      • Data Field Type: Date (MM/DD/YYYY)
L0240|                Error Messages:
L0241|                   Created Date cannot be a date past submission date for Insert.
L0242|                   Updated Date cannot be prior to Created Date.
L0243| Operation
L0244| This field indicates the nature of the entry the database will make for the file.
L0245|      • Valid Values:
L0246|                Insert (create a new record with a unique external identifier).
L0247|                Update (alter an existing record indicated by external identifier).
L0248|                Delete (delete a record indicated by external identifier).
L0249| 
L0250| 
L0251| 
L0252| 
L0253| Washington State Liquor and Cannabis Board CCRS Upload User Guide                                Page 8
```

#### 1.7 Pages 9–10 — Area file

Source: `lcb/guide.txt` L254-L315 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0254| <PAGEBREAK>Area File
L0255| Area is the name identifier for a physical location storing cannabis product.
L0256| 
L0257| Areas represent physical locations at licensed facilities where plants and inventory are located.
L0258| The types of areas are “quarantine” or “non-quarantine.” Examples of areas with a “quarantine”
L0259| designation: waste/ destruction inventory. Use of quarantine is typically a rare occurrence.
L0260| 
L0261| 
L0262| 
L0263| 
L0264| Figure 5. Example area.CSV file
L0265| 
L0266| 1. Name the file for area reports as follows:
L0267|    • Licensees: area_LicenseNumber_YYYYMMDDHHMMSS
L0268|    • Integrators: area_IntegratorID_YYYYMMDDHHMMSS
L0269| 
L0270| 2. Apply the header information as described in the Common File Attributes section on page 8.
L0271| 
L0272| 3. Prepare the data. For commonly used data elements, review the Common File Attributes
L0273|    section on page 8. Listed below are the file fields, with details on the elements unique to the
L0274|    area report:
L0275|    • LicenseNumber
L0276|    • Area
L0277|       The name identifier of the area associated with this record
L0278|           o Example: Drying Room
L0279|           o Data Field Type (character limit): text (75)
L0280|           o Required on which operations: Insert, Update and Delete
L0281|           o Error Messages:
L0282|                   Name is required
L0283|                   Area name is over 75 characters
L0284|    • IsQuarantine
L0285|       Determines whether the area is designated as quarantine or not.
L0286|           o Example: TRUE
L0287|           o Data Field Type (valid values): Y/N
L0288|           o Required on which operations: Insert, Update and Delete
L0289|           o Valid Values:
L0290|                   TRUE
L0291|                   FALSE
L0292|           o Error Messages:
L0293| 
L0294| 
L0295| 
L0296| Washington State Liquor and Cannabis Board CCRS Upload User Guide                           Page 9
L0297| <PAGEBREAK>                o   IsQuarantine must be True or False
L0298|                     Note: IsQuarantine True only applies to imported CBD. There are no quarantine
L0299|                     requirements for cannabis products and must have an entry as False.
L0300|                     For imported CBD: quarantine rules are required until passing tests results as
L0301|                     outlined in WAC 314-55-109 are on hand. Imported CBD must be put into its own
L0302|                     room/area (physically) and marked True (digitally) until passing results are
L0303|                     received.
L0304| 
L0305| •   ExternalIdentifier
L0306| •   CreatedBy
L0307| •   CreatedDate
L0308| •   UpdatedBy
L0309| •   UpdatedDate
L0310| •   Operation
L0311| 
L0312| 
L0313| 
L0314| 
L0315|     Washington State Liquor and Cannabis Board CCRS Upload User Guide                      Page 10
```

#### 1.8 Pages 11–12 — Strain file

Source: `lcb/guide.txt` L316-L382 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0316| <PAGEBREAK>   Strain File
L0317|    Strains represent a specific sub-species strain of cannabis.
L0318| 
L0319|    Strain is also the only upload type that does not include Operation as one of the columns,
L0320|    therefore records can only be created, not updated or deleted. Columns UpdatedBy and
L0321|    UpdatedDate have been omitted from strain.CSV as a result.
L0322| 
L0323|    Strain: Strain is not the product trade name.
L0324| 
L0325|    If Duplicate Strain/Strain Type error message is received, the reporting entity does not have an
L0326|    action to take for correction.
L0327|            Note: This same scenario will occur when completing a plant.CSV. Strain is required on
L0328|            both Plant and Inventory but the strain.CSV does not need to be submitted if the Strain
L0329|            already exists in the system.
L0330| 
L0331| 
L0332| 
L0333| 
L0334|    Figure 6. Example strain.CSV file
L0335| 
L0336| 1. Name the file for strain reports as follows:
L0337|      • Licensees: strain_LicenseNumber_YYYYMMDDHHMMSS
L0338|      • Integrators: strain_IntegratorID_YYYYMMDDHHMMSS
L0339| 
L0340| 2. Apply the header information as described in the Common File Attributes section on page 8.
L0341| 
L0342| 3. Prepare the data. For commonly used data elements review the Common File Attributes section
L0343|    on page 8. Listed below are the file fields, with details on the elements unique to the strain
L0344|    report:
L0345|    •   LicenseNumber
L0346|    •   Strain (name associated with the strain)
L0347|            o Example: Trainwreck
L0348|            o Data Field Type (character limit): text (100)
L0349|            o Required: Yes
L0350|            o Unique: IUD (Name/StrainType Combo)
L0351|            o Error Messages:
L0352|                     ■  Strain is required
L0353|                     ■  Strain is over 100 characters
L0354| 
L0355| 
L0356| 
L0357|    Washington State Liquor and Cannabis Board CCRS Upload User Guide                        Page 11
L0358| <PAGEBREAK>                     ■   Strain name is invalid, cannot be Unknown, THC, or Other.
L0359|                      ■   Duplicate Strain. The Strain must be unique for the LicenseNumber.
L0360|                          Note: If Duplicate Strain/StrainType error message is received, the
L0361|                          assumption is that strain exists in the system and the reporting entity does
L0362|                          not have an action to take for correction.
L0363| •   Strain Type
L0364|     The sub-species of cannabis
L0365|             •   Example: Sativa
L0366|             •   Data Field Type (character limit): text (50)
L0367|             •   Required: Yes
L0368|             •   Unique: IUD (Name/StrainType Combo)
L0369|             •   Valid Values:
L0370|                       ■  Indica
L0371|                       ■  Sativa
L0372|                       ■  Hybrid
L0373|             •   Error Messages:
L0374|                       ■ Invalid Strain Type
L0375|                       ■ StrainType is required
L0376| •   CreatedBy
L0377| •   CreatedDate
L0378| 
L0379| 
L0380| 
L0381| 
L0382|     Washington State Liquor and Cannabis Board CCRS Upload User Guide                         Page 12
```

#### 1.9 Pages 13–15 — Product file (categories, Table 2, UnitWeightGrams, Description)

Source: `lcb/guide.txt` L383-L521 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0383| <PAGEBREAK>   Product File
L0384|    The product is the distinct type of item with attributes that distinguish it from other item types.
L0385| 
L0386|    This report captures the category and sub-category of the cannabis products created – these
L0387|    reports are initially created for any new product (similar to a new area or strain), but future
L0388|    harvests and production of existing products are to be captured elsewhere, such as through
L0389|    inventory and file submissions.
L0390| 
L0391| 
L0392| 
L0393| 
L0394|    Figure 7. Example product.CSV file
L0395| 
L0396| 1. Name the file for product as follows:
L0397|        •   Licensees: product_LicenseNumber_YYYYMMDDHHMMSS
L0398|        •   Integrators: product_IntegratorID_YYYYMMDDHHMMSS
L0399| 
L0400| 2. Apply the header information as described in the Common File Attributes section on page 8.
L0401| 
L0402| 3. Prepare the data. For commonly used data elements review the Common File Attributes section
L0403|    on page 8. Listed below are the file fields, with details on the elements unique to the product file:
L0404|    •   LicenseNumber
L0405| 
L0406|    •   InventoryCategory
L0407|           o Example: PropagationMaterial
L0408|           o Field Type (max character): text (50)
L0409|           o Required on which operations: Insert, Update and Delete
L0410|           o Valid Values:
L0411|                   PropagationMaterial
L0412|                   HarvestedMaterial
L0413|                   IntermediateProduct
L0414|                   EndProduct
L0415|           o Error Messages:
L0416|                   InventoryCategory is required
L0417|                   Invalid InventoryCategory/InventoryType combination
L0418| 
L0419|    •   InventoryType (product type)
L0420|           o Example: Seed
L0421|           o Data Field Type (character limit): text (50)
L0422|           o Required on which operations: Insert, Update and Delete
L0423| 
L0424| 
L0425| 
L0426| 
L0427|    Washington State Liquor and Cannabis Board CCRS Upload User Guide                             Page 13
L0428| <PAGEBREAK>           o   Valid Values:
L0429|                     InventoryCategory determines valid value options, one column in chart below
L0430|                       for each valid InventoryCategory
L0431|                     If ‘Useable Cannabis’ is selected, UnitWeightGrams cannot be 0 or negative
L0432|            o   Error Messages:
L0433|                     InventoryType is required
L0434|                     If Useable Cannabis is selected, Unit Weight Gram cannot be 0
L0435|                     If Useable Cannabis is selected, Unit Weight Gram cannot be negative
L0436| 
L0437| 
L0438|     PropagationMaterial    HarvestedMaterial    IntermediateProduct    EndProduct
L0439|     Clones                 Flower Lot           Cannabis Mix           Cannabis Mix Infused
L0440|     Plant                  Flower Unlotted      CBD                    Cannabis Mix Packaged
L0441|     Seed                   Other Material Lot   Food Grade Solvent     Capsule
L0442|                                                 Concentrate
L0443|                            Other Material       Infused Cooking Medium CO2 Concentrate
L0444|                            Unlotted
L0445|                            Wet Flower           Waste                   Concentrate for
L0446|                                                                         Inhalation
L0447|                            Waste                                        Ethanol Concentrate
L0448|                                                                         Hydrocarbon
L0449|                                                                         Concentrate
L0450|                                                                         Liquid Edible
L0451| 
L0452|                                                                         Non-Solvent Based
L0453|                                                                         Concentrate
L0454|                                                                         Sample Jar
L0455|                                                                         Solid Edible
L0456|                                                                         Suppository
L0457|                                                                         Tincture
L0458|                                                                         Topical Ointment
L0459|                                                                         Transdermal
L0460|                                                                         Usable Cannabis
L0461|                                                                         Waste
L0462| 
L0463|     Table 2. Valid InventoryCategory and InventoryType values
L0464| 
L0465| •   Name (name associated with the product)
L0466|       o Example: Purple Seeds
L0467|       o Data Field Type (character limit): text (75)
L0468|       o Required on which operations: Insert, Update and Delete
L0469| 
L0470| 
L0471| 
L0472| 
L0473|     Washington State Liquor and Cannabis Board CCRS Upload User Guide                    Page 14
L0474| <PAGEBREAK>           Error Messages:
L0475|                 Name is required
L0476|                 Name is over 75 characters
L0477| 
L0478| •   Description (product description)
L0479|        o Example: This is a group of seeds
L0480|        o Data Field Type (character limit): text (250)
L0481|        o Required on which operations: not required
L0482|                      ■  Note: required when inventorytype = Useable cannabis, or Cannabis Mix
L0483|                         Packaged
L0484| 
L0485| •   UnitWeightGrams (weight in grams per unit)
L0486|        o Example: 3.5
L0487|        o Data Field Type (character limit): Decimal (10,2)
L0488|        o Required on which operations: Insert, Update and Delete
L0489|                    ■  Note: required when InventoryType = Useable cannabis, or Cannabis Mix
L0490|                        Packaged All other product types weight can be reported as 0
L0491| 
L0492| •   ExternalIdentifier
L0493| •   CreatedBy
L0494| •   CreatedDate
L0495| •   UpdatedBy
L0496| •   UpdatedDate
L0497| •   Operation
L0498| 
L0499|     For Labs Only
L0500|     Note: For labs, the product.CSV file will operate as your inventory report.
L0501| 
L0502| 
L0503| •   Name: Product name provided by the licensee who submitted the sample for testing.
L0504| •   Description: This optional field can be the product description provided by the licensee who
L0505|     sent the test sample, or provide detail on the sample itself, such as the container it arrived in,
L0506|     condition of the sample, etc.
L0507| •   Inventory Type: Currently, within CCRS, Cannabis Mix may be categorized as Intermediate
L0508|     Product and sent to a retail licensee under this product category. Clone must be recorded as
L0509|     Plant and categorized as Propagation Material within CCRS.
L0510| •   UnitWeightGrams: Weight of the sellable product unit (not including packaging). Any one
L0511|     sellable product may not exceed the individual carry limit.
L0512|         o Example 1: Sellable product = 2 grams of flower; unit weight of 2 grams
L0513|         o Example 2: Sellable product = 1 pre roll; unit weight of 1 gram
L0514|         o Example 3: Sellable product = 1 package of edibles; unit weight of 10 grams
L0515|         o Example 4: Sellable product = 1 concentrate for inhalation cartridge; unit weight of 2
L0516|             grams
L0517| 
L0518| 
L0519| 
L0520| 
L0521|     Washington State Liquor and Cannabis Board CCRS Upload User Guide                            Page 15
```

#### 1.10 Pages 16–18 — Inventory file

Source: `lcb/guide.txt` L522-L647 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0522| <PAGEBREAK>Inventory File
L0523| Inventory represents the physical inventory that exists at a facility.
L0524| 
L0525| Inventory.CSV is required weekly by any licensed facility that owns the inventory, only when
L0526| inventory exists that is unreported, or unreported updates to an existing inventory. No report is
L0527| needed if there are no changes.
L0528| 
L0529| File Dependencies: The inventory file is dependent on existing data records in Strain, Area and
L0530| Product. Referenced files must be submitted prior to this submission by at least 10 minutes.
L0531| 
L0532| 
L0533| 
L0534| 
L0535| Figure 8. Example inventory.CSV file
L0536| 
L0537| 1. Name the file for product as follows:
L0538|     •   Licensees: inventory_LicenseNumber_YYYYMMDDHHMMSS
L0539|     •   Integrators: inventory_IntegratorID_YYYYMMDDHHMMSS
L0540| 
L0541| 2. Apply the header information as described in the Common File Attributes section on page 8.
L0542| 
L0543| 3. Prepare the data. For commonly used data elements review the Common File Attributes
L0544|    section on page 8. Listed below are the file fields, with details on the elements unique to the
L0545|    inventory file:
L0546| 
L0547| •   LicenseNumber
L0548| •   Strain (the name of the associated strain)
L0549|        o Example: Trainwreck
L0550|        o Data Field Type (character limit): text (100)
L0551|        o Required on which operations: Insert, Update and Delete
L0552|        o Valid Values: Strain.Strain
L0553|        o Error Messages:
L0554|                ■  Strain is required
L0555|                ■  Invalid Strain
L0556|                ■  Strain is over 100 characters
L0557|                ■  Strain Name reported is not linked to the license number. Please ensure the
L0558|                   strain being reported belongs to the licensee
L0559| •   Area (the associated area)
L0560|        o Example: Dry Droom
L0561|        o Data Field Type (character limit): text (75)
L0562|        o Required on which operations: Insert, Update and Delete
L0563|        o Valid Values: Area.Name
L0564| 
L0565| 
L0566| 
L0567| Washington State Liquor and Cannabis Board CCRS Upload User Guide                          Page 16
L0568| <PAGEBREAK>           o    Error Messages:
L0569|                      Area is required
L0570|                      Invalid Area
L0571| 
L0572| •   Product (the associated product)
L0573|             •   Example: Seed
L0574|             •   Data Field Type (character limit): text (75)
L0575|             •   Required on which operations: Insert, Update and Delete
L0576|             •   Valid Values: Product.Name
L0577|             •   Error Messages:
L0578|                       ■  Product is required
L0579|                       ■  Invalid Product
L0580|                          Note: If you receive this error message, ensure you have already
L0581|                          submitted this product on the product.CSV, and validate that you have
L0582|                          submitted this product name in the same format and spelling as previously
L0583|                          submitted on the product.CSV
L0584| •   InitialQuantity (quantity when inventory was received)
L0585|             o Data Field Type: decimal
L0586|             o Required on which operations: Insert, Update and Delete
L0587|             o Error Messages:
L0588|                     InitialQuantity is required
L0589|                     InitialQuantity must be numeric
L0590|                     No negative entries allowed
L0591| •   QuantityOnHand (quantity of inventory at this point in time)
L0592|            o Data Field Type: decimal
L0593|            o Required on which operations: Insert, Update and Delete
L0594|            o Error Messages:
L0595|                     QuantityOnHand is required
L0596|                     QuantityOnHand must be numeric
L0597|                     QuanityOnHand is greater than InitialQuantity
L0598|                     No negative entries allowed
L0599| •   TotalCost (total cost associated with the inventory item)
L0600|     CCRS requires a value above $0.00 to be entered on the Total Cost field for an inventory ID to
L0601|     be reported. While the provided Trade Samples do not have a value, a value of $0.01 needs to
L0602|     be entered into the Total Cost field for Trade Samples. Please ensure you are including in the
L0603|     name and Description: Trade Sample.
L0604|     Note: Used to determine if a sale was made where the sales price was less than the cost
L0605|             o Data Field Type: decimal
L0606|             o Required on which operations: Insert, Update and Delete
L0607|             o Error Messages:
L0608|                        TotalCost is required
L0609|                        TotalCost must be numeric
L0610| 
L0611| 
L0612| 
L0613|     Washington State Liquor and Cannabis Board CCRS Upload User Guide                       Page 17
L0614| <PAGEBREAK>                         TotalCost cannot equal 0
L0615|                          No negative entries allowed
L0616| •   IsMedical (whether the inventory is medical or recreational)
L0617|             •   Data Field Type (valid values): bool (Y/N)
L0618|             •   Required on which operations: Insert, Update and Delete
L0619|             •   Valid Values:
L0620|                       ■  TRUE
L0621|                       ■  FALSE
L0622|             •   Error Messages:
L0623|                        IsMedical must be True or False
L0624| •   ExternalIdentifier
L0625| •   CreatedBy
L0626| •   CreatedDate
L0627| •   UpdatedBy
L0628| •   UpdatedDate
L0629| •   Operation
L0630| 
L0631|     Strain: Strain detail will affect other files if not reported accurately and kept up to date. Strain
L0632|     listed and verified in the strain file is not the product trade name. For propagation and harvest,
L0633|     the strain is the name of the strain referenced during the growing cycle. For intermediate and
L0634|     end products, the strain name is the primary strain source or “mix” as appropriate.
L0635| 
L0636|     Product: Primary reference is WAC 314-55-010.
L0637| 
L0638|     TotalCost: The total cost should represent the cost of the initial quantity of the inventory item.
L0639| 
L0640|     IsMedical: This field may only be marked TRUE if passing test results have been received that
L0641|     verify the inventory meets the standards for compliant medical product as outlined in WAC 314-
L0642|     55-102 & WAC 246-70- 050.
L0643| 
L0644| 
L0645| 
L0646| 
L0647|     Washington State Liquor and Cannabis Board CCRS Upload User Guide                             Page 18
```

#### 1.11 Pages 30–32 — Inventory Adjustment file (reasons, AdjustmentDetail, Table 5)

Source: `lcb/guide.txt` L1048-L1157 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L1048| <PAGEBREAK>    Inventory Adjustment File
L1049| 
L1050|     Inventory Adjustments record the event that increases or decreases the quantity of inventory on-
L1051|     hand for a defined reason.
L1052| 
L1053|     An InventoryAdjustment.CSV is required weekly by any licensed facility that owns the inventory,
L1054|     only when an inventory adjustment event happened that was unreported, or unreported updates
L1055|     to an existing inventory adjustment.
L1056| 
L1057|     File Dependencies: The Inventory Adjustment file is dependent on existing data in Inventory.
L1058|     Inventory files must be submitted with or prior to this submission.
L1059| 
L1060| 
L1061| 
L1062| 
L1063|     Figure 13. Example inventoryAdjustment.CSV
L1064| 
L1065| 1. Name the file for inventory adjustment reports as follows:
L1066|        •   Licensees: inventoryAdjustment_LicenseNumber_YYYYMMDDHHMMSS
L1067|        •   Integrators: inventoryAdjustment_IntegratorID_YYYYMMDDHHMMSS
L1068| 
L1069| 2. Apply the header information as described in the Common File Attributes section on page 8.
L1070| 
L1071| 3. Prepare the data. For commonly used data elements review the Common File Attributes section
L1072|    on page 8. Listed below are the file fields, with details on the elements unique to the inventory
L1073|    adjustment file:
L1074| 
L1075| •   LicenseNumber
L1076| 
L1077| •   InventoryExternalIdentifier (assigned identifier for the inventory being adjusted)
L1078|        o Data Field Type (character limit): text (100)
L1079|        o Required on which operations: Insert, Update and Delete
L1080|        o Valid Values: Inventory.ExternalIdentifier
L1081|        o Error Messages:
L1082|             InventoryExternalIdentifier is required
L1083|             Invalid InventoryExternalIdentifier
L1084|               Note: If you receive this error message:
L1085|                    ■    Ensure you have already submitted this external ID on the inventory.CSV.
L1086|                    ■    Validate that you have submitted the external ID in the same format and
L1087|                         characters as previously submitted on the inventory.CSV.
L1088| 
L1089| 
L1090| 
L1091| 
L1092|     Washington State Liquor and Cannabis Board CCRS Upload User Guide                        Page 30
L1093| <PAGEBREAK>•   AdjustmentReason (reason for Inventory Adjustment)
L1094|        o Example: Destruction Error
L1095|        o Data Field Type (character limit): text (50)
L1096|        o Required on which operations: Insert, Update and Delete
L1097|        o Valid Values:
L1098|             Destruction
L1099|             Reconciliation
L1100|             Lost
L1101|             Seizure
L1102|             Theft
L1103|             Other
L1104|        o Error Messages:
L1105|             AdjustmentReason is required
L1106|             Invalid AdjustmentReason
L1107| •   AdjustmentDetail (notes of the adjustment)
L1108|        o Data Field Type (character limit): text (250)
L1109|        o Required: when Other or Theft is selected for Adjustment reason.
L1110|        o Error Messages:
L1111|             Inventory AdjustmentDetail missing
L1112| •   Quantity (amount of inventory adjusted)
L1113|       o Data Field Type: decimal
L1114|       o Required on which operations: Insert, Update and Delete
L1115|       o Description: The amount the inventory was adjusted
L1116|       o Error Messages:
L1117|             Quantity is required
L1118|             Quantity must be numeric
L1119|             No Negative entries allowed
L1120|                Note: Units of measure need to be consistent for the inventory type (grams, each,
L1121|                etc.).
L1122| •   AdjustmentDate (date inventory was adjusted)
L1123|        o Data Field Type: date (MM/DD/YYYY)
L1124|        o Required on which operations: Insert, Update and Delete
L1125|        o Error Messages:
L1126|             AdjustmentDate is required
L1127|             AdjustmentDate must be a date
L1128| •   ExternalIdentifier
L1129| •   CreatedBy
L1130| •   CreatedDate
L1131| •   UpdatedBy
L1132| •   UpdatedDate
L1133| •   Operation
L1134| 
L1135| 
L1136| 
L1137| 
L1138|     Washington State Liquor and Cannabis Board CCRS Upload User Guide                      Page 31
L1139| <PAGEBREAK>AdjustmentReason: Daily waste is accounted for under “Other” as related to the harvested
L1140| material inventory referenced in the Inventory file.
L1141|    When to Use Adjustment Reason           CCRS
L1142|    Balance inventory                       Reconciliation
L1143|    Theft                                   Theft
L1144|    LCB Seizure                             Seizure
L1145|    Member left                             Other
L1146|    Limited self-sampling                   Other
L1147|    Budtender Sample                        Other
L1148|    Vendor Sample                           Other
L1149|    Lab Sample Returned                     ReturnedLabSample
L1150|    Destruction/Disposal                    Destruction
L1151|    When cannabis is lost                   Lost
L1152| Table 5. Valid AdjustmentReason values
L1153| 
L1154| 
L1155| 
L1156| 
L1157| Washington State Liquor and Cannabis Board CCRS Upload User Guide                    Page 32
```

#### 1.12 Pages 33–35 — Inventory Transfer file ('required weekly by any licensed facility that receives inventory')

Source: `lcb/guide.txt` L1158-L1262 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L1158| <PAGEBREAK>    Inventory Transfer File
L1159|     Reports when and how much inventory was received by the licensee.
L1160| 
L1161|     Inventory Transfer files record the receipt of inventory transferred into a licensee’s possession.
L1162|     InventoryTransfer.CSV is required weekly by any licensed facility that receives inventory.
L1163| 
L1164|     File Dependencies: Inventory Transfer files are dependent on existing Inventory data for the
L1165|     source and destination inventories using the InventoryExternalIdentifier.
L1166| 
L1167| 
L1168| 
L1169| 
L1170|     Figure 14. Example inventoryTransfer.CSV
L1171| 
L1172| 1. Name the file for inventory transfer reports as follows:
L1173|      • Licensees: inventoryTransfer_LicenseNumber_YYYYMMDDHHMMSS
L1174|      • Integrators: inventoryTransfer _IntegratorID_YYYYMMDDHHMMSS
L1175| 
L1176| 2. Apply the header information as described in the Common File Attributes section on page 8.
L1177| 
L1178| 3. Prepare the data. For commonly used data elements review the Common File Attributes section
L1179|    on page 8. Listed below are the file fields, with details on the elements unique to the inventory
L1180|    transfer file:
L1181| 
L1182| •   FromLicenseNumber (six-digit licensee ID number of the sending licensee facility)
L1183|        o Data Field Type (character limit): text (10)
L1184|        o Required on which operations: Insert, Update and Delete
L1185|           Unique: Insert
L1186|        o Valid Values: Licensee.LicenseNumber
L1187|        o Error Messages:
L1188|             FromLicenseNumber is required
L1189|             FromLicenseNumber must be numeric
L1190|             Duplicate InventoryTransfer for Licensee
L1191|             Invalid FromInventoryExternalIdentifier
L1192|               Note: If you receive this error message, ensure that the sales report has been
L1193|               completed. This field is dependent on the seller completing the sales.CSV.
L1194| 
L1195| •   ToLicenseNumber (six-digit licensee ID number of the receiving licensee facility)
L1196|        o Data Field Type (character limit): text (10)
L1197|        o Required on which operations: Insert, Update and Delete
L1198|        o Unique: Insert
L1199|        o Valid Values: Licensee.LicenseNumber
L1200|        o Error Messages:
L1201| 
L1202| 
L1203|     Washington State Liquor and Cannabis Board CCRS Upload User Guide                           Page 33
L1204| <PAGEBREAK>               ToLicenseNumber is required
L1205|                ToLicense cannot be the same license number as FromLicense
L1206|                ToLicenseNumber must be numeric
L1207|                Invalid ToInventoryExternalIdentifier
L1208|                 Note: If you receive this error message, ensure the inventory has been reported
L1209|                 through the inventory.CSV.
L1210| 
L1211| •   FromInventoryExternalIdentifier (assigned identifier for the inventory that was sent)
L1212|        o Data Field Type (character limit): text (100)
L1213|        o Required on which operations: Insert, Update and Delete
L1214|           Unique: Insert
L1215|        o Valid Values: Inventory.ExternalIdentifier
L1216|        o Error Messages:
L1217|               ■   FromInventoryExternalIdentifier is required
L1218|                   Note: If this error is received:
L1219|                     • Ensure the associated sales report was already uploaded by the seller.
L1220|                     • Ensure the FromInventoryExternalIdentifier on the Transfer report matches
L1221|                          the InventoryExternalIdentifier.
L1222| 
L1223| •   ToInventoryExternalIdentifier (assigned identifier for the inventory that was received)
L1224|        o Data Field Type (character limit): text (100)
L1225|        o Required on which operations: Insert, Update and Delete
L1226|           Unique: Insert
L1227|        o Valid Values: Inventory.ExternalIdentifier
L1228|        o Error Messages:
L1229|             ToInventoryExternalIdentifier is required
L1230| 
L1231| •   Quantity (amount of the inventory transferred)
L1232|       o Data Field Type: decimal
L1233|       o Required on which operations: Insert, Update and Delete
L1234|       o Description: Amount the inventory was adjusted
L1235|       o Error Messages:
L1236|             Quantity is required
L1237|             Quantity must be numeric
L1238|             No negative entries allowed
L1239|                Note: Units of measurement must be consistent for the inventory type (grams, each,
L1240|                etc.).
L1241| 
L1242| •   TransferDate (date on which the inventory was transferred)
L1243|        o Data Field Type: date (MM/DD/YYYY)
L1244|        o Required on which operations: Insert, Update, Delete
L1245|        o Error Messages:
L1246|             TransferDate is required
L1247| 
L1248| 
L1249| 
L1250|     Washington State Liquor and Cannabis Board CCRS Upload User Guide                         Page 34
L1251| <PAGEBREAK>                TransferDate must be a date
L1252| •    ExternalIdentifier
L1253| •    CreatedBy
L1254| •    CreatedDate
L1255| •    UpdatedBy
L1256| •    UpdatedDate
L1257|  •   Operation
L1258| 
L1259| 
L1260| 
L1261| 
L1262|      Washington State Liquor and Cannabis Board CCRS Upload User Guide   Page 35
```

#### 1.13 Pages 36–41 — Sale file (SaleType, taxes, Duplicate Sale note, Table 6 retail required fields)

Source: `lcb/guide.txt` L1263-L1479 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L1263| <PAGEBREAK>    Sale File
L1264|     Records wholesale and retail transactions of inventory and plants and defines quantity and date
L1265|     of a sale.
L1266| 
L1267|     File Dependencies: The sale file depends on existing data in the Plant and Inventory
L1268|     Submissions. These are to be submitted prior to or with this submission.
L1269| 
L1270| 
L1271| 
L1272| 
L1273|     Figure 15. Example sale.CSV file
L1274| 
L1275| 1. Name the file for sale reports as follows:
L1276|     •   Licensees: sale_LicenseNumber_YYYYMMDDHHMMSS
L1277|     •   Integrators: sale_IntegratorID_YYYYMMDDHHMMSS
L1278| 
L1279| 2. Apply the header information as described in the Common File Attributes section on page 8.
L1280| 
L1281| 3. Prepare the data. For commonly used data elements review the Common File Attributes section
L1282|    on page 8. Listed below are the file fields, with details on the elements unique to the sale file:
L1283| 
L1284| •   LicenseNumber
L1285| 
L1286| •   SoldToLicenseNumber (identifier of purchasing facility)
L1287|        o Data Field Type (character limit): number (6)
L1288|        o Required on which operations: Insert, Update and Delete (only when SaleType =
L1289|           Wholesale)
L1290|        o Valid Values: Licensee.LicenseNumber (cannot be sold to same licensee reporting sale)
L1291|        o Error Messages:
L1292|            SoldToLicenseNumber must be numeric
L1293|            Invalid SoldToLicenseNumber
L1294|            Sales cannot be self-reported
L1295| 
L1296| •   InventoryExternalIdentifier (assigned identifier for the inventory that was sold)
L1297|        o Data Field Type (character limit): text (100)
L1298|        o Required on which operations: Insert, Update and Delete
L1299|        o Valid Values: Inventory.ExternalIdentifier
L1300|        o Error Messages:
L1301|             InventoryExternalIdentifier or PlantExternalIdentifier is required
L1302|             Invalid InventoryExternalIdentifier
L1303|               Note: If you have received this error, ensure that you have already reported the
L1304|               inventory in an inventory.CSV
L1305|             Sold item cannot be in Quarantine
L1306| 
L1307| 
L1308|     Washington State Liquor and Cannabis Board CCRS Upload User Guide                         Page 36
L1309| <PAGEBREAK>                Note: If you have recieved this error, ensure your inventory is not reported as being
L1310|                 in a quarantine area.
L1311| 
L1312| •   PlantExternalIdentifier (assigned identifier of the plant that was sold)
L1313|        o Data Field Type (character limit): text (100)
L1314|        o Required on which operations: Insert, Update and Delete
L1315|        o Valid Values: Plant.ExternalIdentifier
L1316|        o Error Messages:
L1317|                     ■   InventoryExternalIdentifier or PlantExternalIdentifier is required
L1318|                     ■   Invalid PlantExternalIdentifier
L1319| 
L1320| •   SaleType (type of sale)
L1321|     o Data Field Type (character limit): text (50)
L1322|     o Required on which operations: Insert, Update and Delete
L1323|     o Valid Values:
L1324|                     ■    RecreationalRetail
L1325|                     ■    RecreationalMedical
L1326|                     ■    Wholesale
L1327|     o Error Messages:
L1328|                     ■    SaleType is required
L1329|                     ■    Invalid SaleType
L1330| 
L1331| •   SaleDate (user submitted date of the sale transaction)
L1332|     o Data Field Type: date (MM/DD/YYYY)
L1333|     o Required on which operations: Insert, Update and Delete
L1334|     o Error Messages:
L1335|                     ■  SaleDate is required
L1336|                     ■  SaleDate must be a date
L1337| 
L1338| •   Quantity (quantity sold)
L1339|     Note: Units of measurement must be consistent for the inventory type (grams, each, etc.)
L1340|     o Data Field Type: decimal
L1341|     o Required on which operations: Insert, Update and Delete
L1342|     o Error Messages:
L1343|                      ■   Quantity is required
L1344|                      ■   Quantity must be numeric
L1345|                      ■   No negative values allowed
L1346| 
L1347| •   UnitPrice (unit price in US Dollars for the inventory/plant sold)
L1348|     o Data Field Type: decimal
L1349|     o Required: Insert, Update and Delete
L1350|     o Error Messages:
L1351|                       ■   UnitPrice is required
L1352| 
L1353| 
L1354| 
L1355|     Washington State Liquor and Cannabis Board CCRS Upload User Guide                         Page 37
L1356| <PAGEBREAK>                     ■   UnitPrice must be numeric (do not use $ symbol or parentheses)
L1357|                      ■   No negative values allowed
L1358| 
L1359| •   Discount (price in US Dollars of the discount applied to the sale)
L1360|     o Data Field Type: decimal
L1361|     o Error Messages:
L1362|                      ■  Discount must be numeric (do not use $ symbol or parentheses)
L1363|                      ■  No negative values allowed
L1364| 
L1365| •   RetailSalesTax (total in US dollars of the sales tax)
L1366|     o Data Field Type: decimal
L1367|     o Error Messages:
L1368|                     ■   RetailSalesTax must be numeric (do not use $ symbol or parentheses)
L1369|                     ■   No Negative values allowed
L1370| 
L1371| •   CannabisExciseTax (total in US dollars of any other tax applied at the time of sale)
L1372|     Note: this is a required field for all retail sales
L1373|     o Data Field Type: decimal
L1374|     o Valid Values: CannabisExciseTax must equal 37% of unit price (except medical)
L1375|     o Error Messages:
L1376|                        ■   CannabisExciseTax must be numeric (do not use $ symbol or parentheses)
L1377|                        ■   CannabisExciseTax does not equal 37% of UnitPrice
L1378|                        ■   Only Medical Sales can be 0
L1379|                        ■   No negative values allowed
L1380| •   SaleExternalIdentifier (assigned identifier for the sale record)
L1381|     o Data Field Type (character limit): text (100)
L1382|     o Required on which operations: Insert, Update and Delete
L1383|     o Unique: Insert
L1384|     o Valid Values: Sale.ExternalIdentifier
L1385|     o Error Messages:
L1386|                     ■   Invalid Sale (UD)
L1387|                     ■   SaleExternalIdentifier not found
L1388|                     ■   SaleExternalIdentifier is over 100 characters
L1389|                     ■   SaleExternalIdentifier is required
L1390|                     ■   Duplicate Sale for Licensee
L1391|                         Note: If you have received this error ensure:
L1392|                                  • Records within a single sale have the same
L1393|                                      SaleExternaldentifier.
L1394|                                  • Records with the same SaleExternalIdentifier have the same
L1395|                                      SaleType and SaleDate
L1396|                                  • All records with the same SaleExternalIdentifier have a unique
L1397|                                      SaleDetailExternalIdentifier
L1398| 
L1399| 
L1400| 
L1401| 
L1402|     Washington State Liquor and Cannabis Board CCRS Upload User Guide                     Page 38
L1403| <PAGEBREAK>•   SaleDetailExternalIdentifier (assigned identifier for the sale record)
L1404|     (InventoryExternalIdentifer, PlantExternalIdentifier, Quantity, UnitPrice, Discount, SalesTax,
L1405|     OtherTax, ExternalIdentifier)
L1406|         o Data Field Type (character limit): text (100)
L1407|         o Required on which operations: Insert, Update and Delete
L1408|            Unique: Insert
L1409|         o Valid Values: Sale.SaleDetailExternalIdentifier
L1410|         o Error Messages:
L1411|                      ■   SaleDetailExternalIdentifier is required
L1412|                      ■   Duplicate Sale detail item for Licensee
L1413|                      ■   Invalid Sale Detail (UD)
L1414|                      ■   SaleDetailExternalIdentifier not found
L1415|                      ■   SaleDetailExternalIdentifier is over 100 characters
L1416| •   ExternalIdentifier
L1417| •   CreatedBy
L1418| •   CreatedDate
L1419| •   UpdatedBy
L1420| •   UpdatedDate
L1421| •   Operation
L1422| 
L1423| 
L1424| 
L1425| 
L1426|     Washington State Liquor and Cannabis Board CCRS Upload User Guide                          Page 39
L1427| <PAGEBREAK>Sale File: Required Data Fields
L1428| Data fields required by license type for .CSV file upload.
L1429| 
L1430| Sales .CSV data fields     Producers Only Processors Only Producer Processors Retail
L1431| LicenseNumber              ■                  ■                 ■                      ■
L1432| SoldToLicenseNumber        ■                  ■                 ■
L1433| InventoryExternalIdentifier ■                 ■                 ■                      ■
L1434| PlantExternalIdentifier    ■ if plant sold                      ■ if plant sold
L1435| SaleType                   ■                  ■                 ■                      ■
L1436| SaleDate                   ■                  ■                 ■                      ■
L1437| Quantity                   ■                  ■                 ■                      ■
L1438| UnitPrice                  ■                  ■                 ■                      ■
L1439| Discount                                                                               ■
L1440| SalesTax                   ■                  ■                 ■                      ■
L1441| OtherTax                                                                               ■
L1442| SaleExternalIdentifier     ■                  ■                 ■                      ■
L1443| CreatedBy                  ■                  ■                 ■                      ■
L1444| CreatedDate                ■                  ■                 ■                      ■
L1445| UpdatedBy                  ■                  ■                 ■                      ■
L1446| UpdatedDate                ■                  ■                 ■                      ■
L1447| Operation                  ■                  ■                 ■                      ■
L1448| Table 6. Required sale.CSV data fields by licensee type
L1449| 
L1450| UnitPrice: Sales price before taxes applied.
L1451| 
L1452| Discount: No discounts are allowable for producers and processors. WAC 314-55-018.
L1453| Discounts can only be offered at a retail sale. The discount must be available to all who meet the
L1454| discount conditions and may not discount the sale price below the cost of acquisition.
L1455| 
L1456| RetailSalesTax: The sum of state and local sales taxes are reflected in this field.
L1457| 
L1458| CannabisExciseTax: The excise taxes on Cannabis transactions. No other tax entry is valid for
L1459| this field. Producers/Processors will not report CannabisExciseTax as they do not have a
L1460| requirement to collect excise taxes in their sale transactions. An entry of 0 CannabisExciseTax is
L1461| only allowed for sale type Wholsale, and sales that meet medical compliance conditions.
L1462| 
L1463| SoldToLicenseNumber: SoldTo only applies to Wholesale transactions (i.e.
L1464| Producers/Processors).
L1465| 
L1466| SaleType: Wholesale is the selection for all sales by producers/processors.
L1467| 
L1468| 
L1469| 
L1470| Washington State Liquor and Cannabis Board CCRS Upload User Guide                          Page 40
L1471| <PAGEBREAK>RecreationalRetail: Sale at retail to a general customer.
L1472| 
L1473| RecreationalMedical: Sale at retail to a qualifying patient or designated provider (RCW
L1474| 82.08.9998).
L1475| 
L1476| 
L1477| 
L1478| 
L1479| Washington State Liquor and Cannabis Board CCRS Upload User Guide                         Page 41
```

## 2. CCRS FAQ — verbatim (https://lcb.wa.gov/ccrs/faq)

#### 2.1 Full FAQ text (navigation stripped)

Source: `lcb/faq.txt` L1-L184 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0001| SOURCE: https://lcb.wa.gov/ccrs/faq
L0002| FETCHED: 2026-09-15 22:07Z
L0003| NOTE: verbatim text extraction of the LCB CCRS FAQ page; navigation stripped.
L0004| 
L0005| CCRS FAQs
L0006| WA.gov Transition
L0007| Q: What is changing?
L0008| A: Washington state is transitioning from SecureAccess Washington (SAW) to a new, unified WA.gov account system, providing a new way to log in to Washington state services. SAW no longer meets current technology, security, or user experience standards. It requires multiple logins and creates barriers for residents and agencies.
L0009| Q: When is this happening?
L0010| A: CCRS will be transitioning to WA.gov in October 2026. The state expects the transition to be complete by the end of 2027. Each agency is responsible for their service transitions and will coordinate those timeframes with customers and WaTech.
L0011| Q: Will SAW accounts automatically transition to WA.gov?
L0012| A: No. All users need to manually set up a new account. Create a WA.gov account here.
L0013| Data Elements
L0014| Q: Why are Other, THC, and Unknown not allowed as Strain names?
L0015| A: As the strain name should be known at the start of growing the flower, it was determined these three entries were not conducive in ensuring public safety and was removed from allowed entries.
L0016| Q: Will price data be included for wholesale and retail sales activity?
L0017| A: Sales data will be collected. Details can be found in the user guide on what content is required to be reported in the sales report fields. Please see the user guide located on the CCRS Resources page.
L0018| Q: Will there be a fixed list of inventory types? Or just broad 'equivalence' categories (eg, Clone/Seed, Plant, Bulk Material, Product)?
L0019| A: This information can be found in resources provided on reporting submittals and data field detail on the CCRS Resources page.
L0020| Q: What date should be entered for Harvest Date if the harvest date is not yet known?
L0021| A: If the harvest date is not yet known, leave a NULL or a blank entry in the Harvest Date. This is not a required field for data submission.
L0022| Q: How are infused Pre-Rolls categorized in CCRS?
L0023| A: Infused pre-rolls are to be categorized as Concentrates in CCRS and thus are subject to the serving/transaction limits of concentrates.
L0024| Data Quality
L0025| Q: How will an integrator access CCRS to send or review data?
L0026| A: Please refer to the Third Party Integrators section of the CCRS website.
L0027| Q: Is there a file size limit?
L0028| A: Please limit file sizes to 1GB or less. While CCRS can accept files up to 2GB in size, the larger the file, the longer it will take to process. By submitting a smaller file, CCRS is able to process the file faster and return either a confirmation or error message to the submitter.
L0029| Q: How do I fix the errors that I receive back from CCRS after submitting a .CSV file to report new or updated data, such as claiming new inventory, updating a plant tag, or noting a new sale?
L0030| A: Please review the Upload User Guide on the CCRS Resources page to learn more about how to make adjustments to the original file, based on the specific type of error received. If you are unable to resolve the errors, please email the LCB Examiners at examiner@lcb.wa.gov, and please email a copy of the .CSV file that was sent to CCRS, as well as forward the error email (along with any attachments) that was returned. The Examiners need to see both the file that was sent and what sort of errors were returned to the licensee in order to troubleshoot the situation.
L0031| Data Reporting
L0032| Q: How to report minor cannabinoids in CCRS inventory?
L0033| A: If you are creating products with minor cannabinoids, you need to enter them into CCRS as Inventory Type CBD, and provide in the product name and description what minor cannabinoid is being reported.
L0034| Q: How do I report trade samples in CCRS inventory?
L0035| A: CCRS requires a value above $0.00 to be entered on the Total Cost field for an inventory ID to be reported. While the provided Trade Samples do not have a value, a value of $0.01 needs to be entered into the Total Cost field for Trade Samples. Please ensure you are including in the name and Description: Trade Sample.
L0036| Q: How to report an adjustment?
L0037| A: Report the Quantity of the adjustment as numeric positive value and in the details provide what the adjustment was for (adding to or subtracting from inventory).
L0038| Q: How does a retailer report a return in CCRS?
L0039| A: If a retailer receives a valid return from a customer, the sale identifier should be deleted from CCRS, and theinventory identifier reported on an Inventory Adjustment as a return, with details provided about why it was a return.
L0040| Q: What is the definition of "weekly reporting"?
L0041| A: Week is defined as Sunday - Saturday.  After the transition period, all licensee weekly reporting will be expected by no later than Sunday for the previous week. Reporting more frequently than weekly is allowed.
L0042| Q: Are licensees expected to have data in CCRS from the start of Dec. 2021 when the system was launched?
L0043| A: Yes, if the license was active during that time then the data needs to be uploaded and reflected in CCRS.
L0044| Q: Are CBD materials are required to be entered into the system?
L0045| A: Yes. Imported CBD is required to have the necessary tests to allow it to be added to cannabis and the records and reporting requirements continue.
L0046| Q: Will the laboratory need to provide COA documents to the LCB?
L0047| A: Labs are required to provide the test results to LCB via the reports established for that purpose. Record maintenance and access remain the same for both the labs and licensees. No changes have been made on the requirement to produce the records if requested by LCB.
L0048| Q: For those that only grow during the summer, will they need to submit a .CSV file weekly during the winter months when there are no changes?
L0049| A: The Upload User Guide on the CCRS Resources page provides more detail on the required frequency of reporting. For seasonal growers, it is expected that reports are submitted when there are actions, updates and changes weekly (if those activities have occurred). It is not the expectation that reporting be submitted when there is no activity to report. A reminder that LCB will be monitoring reporting activity. If information does not support weekly report submissions, the LCB will also be reaching out to confirm the reason for lack of reporting, however keep in mind that there is no reporting required if there are no new data to provide (no updates to existing records, no new inventory lots, no changes to plant tags, no unreported sales, no outgoing manifests, etc. Simply put, if there is nothing new to report, there is no report to submit and no expectation to provide some form of “no change” report, which does not exist.
L0050| Q: Why does the Area specification mention that IsQuarantine is only for imported CBD? How is that related to Area data?
L0051| A: There are no quarantine requirements for cannabis products. You will have an entry as FALSE. For imported CBD: quarantine rules are required until passing tests results as outlined in WAC 314-55-109 are on hand. Imported CBD must be put into its own room/area and marked TRUE until passing results are received.  This information is available in the Upload User Guide on the CCRS Resources page. Please be sure that Area is NOT set by default to “TRUE” for the answer to “IsQuarantine”, as this is typically not the case and would only apply in very select situations (such as when CBD has been received from a non I-502, such as from outside the state of Washington, and is awaiting testing results). All other cannabis products should NOT be listed as “IsQuarantine” by default, which will happen if the status for Area is set to TRUE (the system will treat inventory and products contained in that area as being in quarantine).
L0052| Q: What happens if an Update operation is performed prior to an Insert operation, will it default to inserting that case? If so, can we just always specify the operation to be Update even if it is an Insert?
L0053| A: The record doesn't exist, so an error message would be received.
L0054| Q: Can a Lab sub-contract out their testing? If they do, who is responsible for reporting the test result?
L0055| A: Labs may subcontract samples for a limited suite of tests and circumstances. The primary lab is responsible for reporting the test results directly to CCRS for the applicable product tested. WAC 314-55-102 (5) and WAC 314-55-102 (5) address referencing and subcontracting.
L0056| Q: For the inventory sheet, is ‘total cost’ the individual unit cost * quantity in stock, or the unit cost for each item in stock?
L0057| A:  The Upload User Guide on the CCRS Resources page explains the following: TotalCost is the total cost associated with a licensee's inventory and stock.
L0058| Q: If a retailer incorrectly enters the ‘FromInventoryExternalIdentifier’ when they are receiving new products, how will they correct this?
L0059| A: They would perform an "Update" operation. That would update the record and correct the error.  The receiving license should only be providing the new (if any) “ToInventoryExternalIdentifier”, as the “From” ID is assigned as the original ID by the producer or processor.  If the license is going to use a new ID, it is important they submit an Inventory Transfer file, to provide both the old and new IDs for inventory items.
L0060| Q: What is the correct way to enter a product's weight in .CSV submissions?
L0061| A: UnitWeightGrams is the weight of the sellable product unit (not including packaging). Any one sellable product may never exceed the individual carry limit allowed for a consumer.
L0062| Unit Examples:
L0063| Sellable product = 2 grams of flower - UnitWeightGrams  = 2 grams
L0064| Sellable product = 1 pre roll - UnitWeightGrams = 1 gram
L0065| Sellable product = 1 package of edibles - UnitWeightGrams = 10 grams
L0066| Sellable product = 1 concentrate for inhalation cartridge - UnitWeightGrams = 2 grams
L0067| General
L0068| Q: What is the expectation of licensees using CCRS?
L0069| A: Please see the Upload User Guide located on the CCRS Resources page.
L0070| Q: Does CCRS apply to all licensees, including retailers?
L0071| A: Yes. This applies to all cannabis license types and to certified labs.
L0072| Q: How do we do a plant ID in CCRS?
L0073| A: The plant ID will not be generated by the state software system.  Licensees will need to establish/choose an inventory numbering system and then assign ID's to plants. A reminder that requirements to tag plants has not changed; plants must still be tagged. The plant tag will now be the ID a licensee assigns to that plant and has recorded in the appropriate .CSV file.
L0074| Q: What time zone should dates/times be documented in?
L0075| A: For reporting purposes, the file name should be referenced in PST.
L0076| Q: How should a licensee  create a Sample to send to the Labs?
L0077| A: The sample sent to the lab should be the same external identifier for the lot that was created original. This way the Lab results are attached to the larger batch. Keep IDs from original external ID, do not break them out as this will cause issues with required testing of all your products.
L0078| Q: If a license changes physical locations, do they keep the same original six-digit license number?
L0079| A: No, the six-digit license number is associated with a physical address, so the license holder will receive a new six-digit license number.
L0080| Q: Can any approved user associated with the license make changes to who the integrator is? For example, an entity that has permissions to upload data to CCRS on behalf of the licensee?
L0081| A: No, only the active administrator of the license can assign or remove an integrator.
L0082| Q: I would like to change the email account currently associated with my license as the active administrator, how do I do that?
L0083| A: You must request a change to your license information by emailing customerservicelicensing@lcb.wa.gov from the current administrator email account of the license requesting a change of email address for your license.
L0084| Q: I am a licensee and my integrator has not been reporting my data to CCRS. Who is held responsible for making sure my data is reported?
L0085| A: The licensee is ultimately responsible to meet data reporting obligations, and may need to make a business decision with regard to which integrator they use if their data is not being reported.
L0086| Integrators
L0087| Q: Does CCRS provide an integration sandbox for integrators to develop against?
L0088| A: The LCB provides all cannabis licensees, labs and integrators access to the PREproduction CCRS environment for training and testing.
L0089| Q: How does an integrator gain access to CCRS to report on behalf of licensees?
L0090| A: Once an integrator is granted access to CCRS via the cannabis examiners, licensees will have the option to assign themselves that integrator through CCRS. Integrators do not have the ability to adjust licensee assignment. It is critically important that licensees who opt to use an integrator go into CCRS and assign that integrator to their license, otherwise the integrator cannot upload any data on behalf of that licensee. Licensees must “unlock the door” to allow an integrator access to CCRS, and if a licensee holds multiple licenses, they must assign the integrator to every license they hold individually. Assigning an integrator to one licensee will not automatically provide access to CCRS for any other licenses they own.
L0091| Q: How will licensee software vendors authenticate on behalf of licensees?
L0092| A: Integrators will be assigned a specific ID and will need to use the SecureAccess Washington (SAW) to authenticate and report on behalf of a licensee.
L0093| Q: Does the integrator need to be preliminarily approved or validated by LCB before it is added to the system by the licensee to enable the integrator to upload reports on the licensee’s behalf?
L0094| A: Yes. Integrators providing reporting services for licensees will need to be added to the approved integrator list in order for licensees to assign them reporting permissions. The steps for approval are listed on the CCRS Third Party Integrator Approval Process page.
L0095| Q: If any licensees were to add an integrator within the PREproduction environment, do they need to do so again on the live site?
L0096| A: Yes. These environments are autonomous and do not share administration or reporting data.
L0097| Q: Can only one user be associated with our CCRS integrator account?
L0098| A: Two users can be associated with your integrator account, meaning the integrator can have up to two emails associated with the license and thus with access to submit data to CCRS on behalf of the licensee (their client).
L0099| Q: What filename format does an integrator use when uploading on behalf of a lab?
L0100| A: Integrators uploading files on a Lab's behalf would use the same Lab .CSV file that the labs would use. The CCRS specification file has the naming conventions.
L0101| Q: If an integrator is submitting .CSV reports on behalf of a licensee, should we expect that only the integrator will be notified of errors via email, or does the licensee receive an email notification as well?
L0102| A: Yes, the individual (integrator) uploading the .CSV file would be notified of any errors, but the licensee will not receive an email. However, many integrators have set up a method to automatically send a copy of any errors to the licensee. Please ask your integrator to confirm if they will automatically be sending you the licensee a copy of any errors generated when data is submitted to CCRS. If so, please be sure to check any spam filters that might initially block these error emails or look in junk folder to see if the error emails were sent there.
L0103| Manifests
L0104| Q: Can licensees use Manifests generated by their integrator or Point of Sale (POS) systems?
L0105| A: No, the only accepted Manifests are the PDFs generated by submitting the Manifest.CSV to CCRS.
L0106| Q: Can a licensee submit a contingency manifest directly to LCB without uploading to CCRS?
L0107| A: No, there is no contingency Manifest option. Manifests must be generated by CCRS to be valid.
L0108| Medical Products and Sales
L0109| Q: As a cannabis producer/processor licensee, how do I comply with medically compliant product requirements?
L0110| A: To start, we recommend reviewing the information on Department of Health (DOH) Cannabis Program page. When reporting Medically Compliant products in CCRS, on the Inventory.csv, the Inventory External Identifier category must be marked as “Medically Compliant.”
L0111| Q: As a cannabis retail licensee, I want to register patients with a Cannabis Medical Card in the Medical Cannabis Authorization Database. What are the requirements?
L0112| A: The DOH website provides these requirements.
L0113| Q: As a cannabis retail licensee, how do I give Cannabis Medical Card holders the new excise tax exemption?
L0114| A: For a retailer to give the excise tax (begins June 6, 2024) exemption to qualified medical patients, all of these requirements must be met:The retail store has a Medical Endorsement from DOH.
L0115| The Medical Card holder is registered in the Medical Cannabis Authorization Database.
L0116| The product(s) are Medically Compliant products.
L0117| Q: What does the cannabis retail licensee need to report in CCRS for sales that meet these conditions?
L0118| A: All of the conditions below must be met:The retail licensee must have a medical endorsement.
L0119| The product must be marked in the retailer’s inventory upload to CCRS as “Medically Compliant.”
L0120| The sale must be RecreationalMedical when reporting to CCRS.
L0121| If all these conditions are met, the two tax columns can be reported as $0.00 to show the tax exemption. All sales that do not meet these conditions must have taxes reported following current reporting requirements.
L0122| For information on tax reporting requirements related to the exemption, please visit the Cannabis Taxes and Fees resource page.
L0123| Posting Test Results
L0124| Q: Do licensees and labs have 90 days before they are required to start uploading test results?
L0125| A: Any tests not in the system that took place prior to Mar. 26 should be properly manifested and reported in CCRS as soon as possible. LCB will work with labs to educate on proper compliance practices when we detect instances of tests conducted before Mar. 26 that impact products in the hands of retailers or preparing to be shipped to retailers. All tests after Mar. 26 which include any of the fields listed in the notice must be uploaded to CCRS.
L0126| Q: This seems like a new requirement. After 90 days has passed, how will the LCB Education and Enforcement Division approach addressing these requirements for product tested before Mar. 26, 2025?
L0127| A: This is not a new mandate. Test reporting requirements are in addition to licensee and lab obligations to maintain accurate traceability records, including accurate CCRS manifests. LCB will work with labs and licensees to educate and gain compliance when we find instances of tests conducted before 26 March, not entered in CCRS, that impact products likely in the hands of retailers or products preparing to be shipped to retailers.
L0128| Q: What happens if Labs or licensees do not report data during or after the 90 day education period?
L0129| A: Following the 90 day education period, all licensees and certified labs are expected to continue complying with all laws and regulations regarding testing, test reporting, and traceability. The education window is not an amnesty period for licensees and labs who, through investigation or follow on compliance checks, are found to have knowingly violated requirements in the WAC.
L0130| Q: Is this a new policy? Do labs or licensees need to go back and enter results and records from the past?
L0131| A: This is not a new policy. Reporting of tests older than six months (prior to Sep. 25, 2024) for any of the fields in WAC will be considered as low priority for reporting in CCRS as they are less likely to still relate to products currently in the market. If labs or licensees are aware of any tests related to currently available products that predate that date they should be considered priority for public safety. All results of tests for any of the fields set forth in WAC that impact inventory or products currently on hand should be uploaded into CCRS in accordance with WACs as soon as possible. LCB staff will still require labs and licensees to ensure any samples collected for testing, no matter the date, meet traceability requirements and are reported in accordance with applicable law and regulation.
L0132| Q: If I have issues reporting test results who can I contact?
L0133| A: If you have issues or delays in reporting test results, please notify LCB within 24 hours by contacting the Examiners at: examiner@lcb.wa.gov.
L0134| Public Records
L0135| Q: Will licensees be able to access analytics from CCRS?
L0136| A: A license can request their data from the examiner unit for CCRS. An Integrator can request a copy of the licensee they are working with data (license must be included on the request). For all other requests, please contact Public Records.
L0137| Q: Can the LCB make a copy of the entire Leaf database available once it is turned off, similar to FOIA public records requests, but with full export?
L0138| A: Information on public records requests are available here. Full publishing of the entire backup is not available.
L0139| Q: Can we get access to all the CCRS data including products sold (in order to assess trends)? Or will the data at least be public for sales figures by license, similar to what we can access currently?
L0140| A: This information is not available on our public website, but information on public records requests are available here.
L0141| Q: What is the process for seeing what has previously been reported to CCRS for this given license so that we can align our future .csv imports to use the same external identifiers?
L0142| A: Licensees would request CCRS records through a Public Records request if seeking licensee specific information. There is no direct access to the data that has already been reported. The original licensee records still fall under the archive requirements found in WAC 314-55.
L0143| Rules
L0144| Q: Will there be explicit rules on what can be transported between licensees?
L0145| A: There are no changes to licensee permissions by licensee type and no changes in the types of products that can be transported between licensees.
L0146| Q: Will there be explicit rules on 'conversions' from one type to another? How will these be enforced? Leaf allowed anything to be ‘re-typed’ into anything.
L0147| A: Rules on valid conversions have not changed per RCW or WAC. CCRS will not “enforce” conversions by the system architecture. The enforcement of conversions will be based on the detail reported to WSLCB and follow up conversations between licensees and their Enforcement Officer/Compliance Consultant.
L0148| Q: WAC 314-55-083H still makes reference to "unique identifier generated by the traceability system." Will we be returning to that requirement?
L0149| A: The CCRS reports and the LCB will not be generating the IDs. Licensees will need to use reliable inventory tracking methodologies to assign IDs to their inventory and provide the ID (called external identifiers) when reporting via the CCRS reports. It is recommended that where possible to continue to use the existing ID structures. The WAC requirement going forward will be for IDs, not for IDs generated by the State.
L0150| Q: Will there be a redefinition of the concept of “failure to maintain traceability” or what it means to maintain compliance given the significant change?
L0151| A: No. The change in systems for reporting does not change the underlying concept that reporting is required and that accurate reporting and records maintenance is expected.
L0152| Sales
L0153| Q: When entering the discount and tax information in the Sales.CSV does the detail apply to the individual unit or the whole transaction?
L0154| A: For the Sale.CSV in a row entry in which QTY is more than 1, the discount and taxes are reflective of the entire transaction. Unit Price is the price of one unit before discount or taxes. A reminder that other tax is Excise tax and is required for retail sales.
L0155| Example:
L0156| QTY = 3
L0157| Unit Price  = $5.00
L0158| Discount = $3.00
L0159| Sales Tax (10%) = $1.20
L0160| Other Tax (37%) = $4.44
L0161| Q: How are Medical Tax Exemptions applied?
L0162| A: The Sale.CSV will record the transaction as a RecreationalMedical sale. The tax for which the qualifying individual is exempt will not be charged and not collected from the individual and is therefore $0.00.  A reminder that a tax exemption is not a "discount." The exemption for a valid medical sale applies to both sales and excise taxes, and is not optional. A patient should not pay either sales or excise tax. For more information on this topic, please visit the Washington State Department of Health's website and FAQ page.
L0163| Q: How do I report Waste in CCRS?
L0164| A: Producers can report the sales of designated waste in the following manner:
L0165| Sale: 3606641600
L0166| Sale Type: Wholesale
L0167| Product Category: Harvest Material
L0168| Product Type: Waste
L0169| The External Identifier must already exist in CCRS. For more information on what waste qualifies to be sold, please see the Cannabis Licensee Education page.
L0170| Tax
L0171| Tax
L0172| Q: How do I pay my cannabis excise tax in CCRS?
L0173| A: See the Cannabis Tax Reporting Guide for instructions on paying cannabis excise tax via CCRS.
L0174| Q: In the WAC (314-55-089) it states “the act of keeping data completely up-to-date in the state traceability system fulfills the monthly reporting requirement” - regarding taxes - will that still be the case or will there be a new process?
L0175| A: Cannabis retailers are still required to send monthly reports. Reporting requirements have not changed. The statements below are specific to producer/processors (reference 314-55-089(2) and 314-55-089(3).Cannabis producer/processors do not have a tax obligation to the WSLCB and the Finance Tax and Fee group is not collecting reports from this group of licensees.
L0176| Producers and Processors should contact their Enforcement and Education Officer if they have questions regarding how to report their information. To be fully compliant with the LCB, licensed cannabis retailers (reference 314-55-089(4) are required to report using LCB form LIQ1295 (Retailers Sales and Excise Tax) and pay their monthly sales/tax information by the tax due date. Retail licensees are required to submit a report to the LCB each month even if they did not have sales completed. Per WAC 314-55-092(2) failure to report and/or pay will be sufficient grounds for the LCB to suspend or revoke a license.
L0177| Technical Details
L0178| Q: Does CCRS allow integrators to use an API?
L0179| A: No. There is no Application Programming Interface (API) for CCRS.
L0180| Q: Does the LCB provide any ‘cloud storage’ to facilitate digital transfer of data between licensees (such as manifests and lab results data)?
L0181| A: No, this is not a service available.
L0182| Q: How are lab results be tracked for retail products?
L0183| A: Records requirements have not changed. Licensees must continue to provide the supporting documentation for all products sold at retail. Reports are being built against the CCRS data submitted for LCB’s use in reviewing test results.
L0184| 
```

## 3. CCRS Integrator API Guide (Aug 2026) — verbatim

#### 3.1 Full API guide text (`lcb/api-2026-08.pdf`). NOTE: integrator-only; the licensee weekly flow is the portal upload in §1.

Source: `lcb/api.txt` L1-L286 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0001| Washington State Liquor and Cannabis Board
L0002| 
L0003| Cannabis Central Reporting System (CCRS)
L0004| Integrator API Guide
L0005| Connecting to CCRS and submitting files via the reporting API
L0006| 
L0007| 
L0008| 
L0009| 
L0010| CIB XXXX 8/26
L0011| <PAGEBREAK>Important Notice
L0012| This guide describes what is required to connect to the CCRS reporting API and submit files. It includes
L0013| short examples of the standard requests involved, for reference.
L0014| It is the integrator's responsibility to design, build, test, secure, and maintain the software used to
L0015| connect to CCRS. Any examples in this guide are for reference only. They show the standard OAuth
L0016| 2.0 and HTTP requests involved, not a supported implementation.
L0017| The Washington State Liquor and Cannabis Board does not provide software development guidance,
L0018| code support, integration support, or debugging for integrator systems, and does not assume
L0019| responsibility for how an integrator builds or operates its connection to CCRS. Integrators are
L0020| responsible for ensuring their systems function correctly and comply with all applicable requirements.
L0021| 
L0022| 
L0023| 
L0024| How it Works
L0025| CCRS accepts file submissions through a reporting API secured with machine-to-machine (M2M)
L0026| authentication. Your software does two things, both using standard protocols:
L0027|    1. Obtain an access token - send your issued credentials to the identity platform and receive a
L0028|       short-lived bearer token (standard OAuth 2.0 client-credentials flow).
L0029|    2. Submit a file - send your data file to the CCRS API over HTTPS, including the bearer token
L0030|       and the integrator email (standard HTTP multipart request).
L0031| 
L0032| 
L0033|  ℹ Note
L0034|  Integrators can implement both steps in whatever language and platform their systems already use, as both
L0035|  are standard protocols. The examples provided show the raw requests for clarity.
L0036| 
L0037| 
L0038| What you need before you start:
L0039|   1. A CCRS M2M account, provisioned through Washington State's identity platform. You will be
L0040|      issued a client ID and client secret.
L0041|   2. One or more authorized uploader email addresses (primary and/or backup) registered for the
L0042|      integrator account.
L0043|   3. The API identifier (audience) and token endpoint for the environment you are connecting to - both
L0044|      are listed under Request Requirements below.
L0045| 
L0046| 
L0047| 
L0048| 
L0049|  Washington State Liquor and Cannabis Board CCRS Integrator API Guide                                  Page 2
L0050| <PAGEBREAK>Request Requirements
L0051| Every file submission must include the following.
L0052| 
L0053| Identity platform token endpoints
L0054|  Pre-Production
L0055|   Token endpoint: https://test-login.wa.gov/oauth/token
L0056|   API identifier:lcb.ccrs.api.pre
L0057| 
L0058| 
L0059|  Production
L0060|   Token endpoint: https://www.login.wa.gov/oauth/token
L0061|   API identifier: lcb.ccrs.api.prod
L0062| 
L0063| 
L0064| 
L0065| 
L0066| CCRS upload endpoint
L0067|  POST https://<ccrs-environment-host>/api/v1/upload
L0068| 
L0069|  ccrs-environment-host:
L0070|  (Pre-Production) precannabisreporting.lcb.wa.gov
L0071|    (Production) cannabisreporting.lcb.wa.gov
L0072| 
L0073|  Example:
L0074|  (Pre-Production) https://precannabisreporting.lcb.wa.gov/api/v1/upload
L0075|    (Production) https://cannabisreporting.lcb.wa.gov/api/v1/upload
L0076| 
L0077| 
L0078| 
L0079| 
L0080| Required headers
L0081|  Header                                     Value
L0082|  Authorization                              Bearer <access token> - the token from step 1
L0083| 
L0084|  X-Uploader-Email                           <primary or backup integrator email> - must be registered for your
L0085|                                             integrator
L0086| 
L0087| 
L0088| 
L0089| File requirements
L0090|   • Format: CSV, following the CCRS file specifications for the data type being submitted.
L0091|   • File name: must include integrator identifier per the CCRS file naming convention. Each file's
L0092|     name identifies which integrator and data type it represents.
L0093|   • One integrator per submission: files in a single request should belong to your integrator
L0094|     account. Please refer to the CCRS FAQ page for more information.
L0095| 
L0096| 
L0097| 
L0098| 
L0099|  Washington State Liquor and Cannabis Board CCRS Integrator API Guide                                            Page 3
L0100| <PAGEBREAK>Connecting Examples
L0101|   ⚠ Important Note
L0102|   The examples below are for reference only. They show a standard OAuth 2.0 token request and a standard
L0103|   HTTPS upload request, which is the underlying protocol rather than a supported CCRS implementation.
L0104|   Integrators are responsible for designing, building, testing, securing, and supporting their own integration.
L0105|   LCB does not provide development support.
L0106| 
L0107| 
L0108| The examples use curl to show the raw HTTP requests in a way that does not depend on any one
L0109| language. Use them to understand the format, then build the same requests in your own system.
L0110| 
L0111| Step 1 - Get an access token
L0112| Send your client ID, client secret, and API identifier to the identity platform's token endpoint using the
L0113| OAuth 2.0 client-credentials grant. You receive a bearer token valid for a limited time.
L0114| The example below uses the pre-production configuration values. Replace only YOUR_CLIENT_ID and
L0115| YOUR_CLIENT_SECRET with the credentials issued to you. The audience value is required and must
L0116| be the API identifier for the environment you are submitting to. A token requested with the wrong
L0117| audience is still issued by the identity platform, but CCRS rejects it at upload.
L0118| 
L0119|  curl --request POST \
L0120|   --url https://test-login.wa.gov/oauth/token \
L0121|   --header "content-type: application/json" \
L0122|   --data '{
L0123|      "client_id": "YOUR_CLIENT_ID",
L0124|      "client_secret": "YOUR_CLIENT_SECRET",
L0125|      "audience": "lcb.ccrs.api.pre",
L0126|      "grant_type": "client_credentials"
L0127|   }'
L0128| 
L0129| A successful response includes an access token:
L0130| 
L0131|  {
L0132|      "access_token": "eyJhbGciOi...<token>...",
L0133|      "token_type": "Bearer",
L0134|      "expires_in": 86400
L0135|  }
L0136| 
L0137| Tokens expire 24 hours after they are issued. Request a new token when needed rather than hard-
L0138| coding one. Cache and reuse a token until close to its expiry rather than requesting one per file.
L0139| 
L0140| 
L0141| 
L0142| 
L0143|  Washington State Liquor and Cannabis Board CCRS Integrator API Guide                                       Page 4
L0144| <PAGEBREAK>Step 2 - Submit a file
L0145| Send your file to the CCRS API endpoint, including the bearer token from Step 1 and the uploader
L0146| email header.
L0147| This example sends a single file as multipart form data. Replace the host with the correct CCRS
L0148| environment, the token with the one from Step 1, the email with an authorized uploader email, and the
L0149| file with your correctly named CCRS data file.
L0150| 
L0151|  curl --request POST \
L0152|   --url https://<ccrs-environment-host>/api/v1/upload \
L0153|   --header "Authorization: Bearer eyJhbGciOi...<token>..." \
L0154|   --header "X-Uploader-Email: uploader@example.com" \
L0155|   --form "files=@Area_YOURIDENTIFIER_20260101120000.csv"
L0156| 
L0157| 
L0158| Submitting more than one file in a single request
L0159| To send several files at once, repeat the --form "files=@..." argument once per file. All files in a single
L0160| request must belong to your integrator account.
L0161| 
L0162|  curl --request POST \
L0163|   --url https://precannabisreporting.lcb.wa.gov/api/v1/upload \
L0164|   --header "Authorization: Bearer eyJhbGciOi...<token>..." \
L0165|   --header "X-Uploader-Email: uploader@example.com" \
L0166|   --form "files=@Area_YOURIDENTIFIER_20260101120000.csv" \
L0167|   --form "files=@Strain_YOURIDENTIFIER_20260101120001.csv" \
L0168|   --form "files=@Product_YOURIDENTIFIER_20260101120002.csv"
L0169| 
L0170| Please note: a submission is validated as a set. If any file fails validation, the whole request is rejected and
L0171| none of the files are accepted. The response lists each problem. Correct the listed files and resubmit. A
L0172| partial batch is never left half-processed.
L0173| 
L0174| A note on the standard
L0175| The token request follows the standard OAuth 2.0 client-credentials flow. For authoritative details, refer
L0176| to the OAuth 2.0 specification and the identity platform's documentation provided with your credentials.
L0177| CCRS follows the standard and does not define a proprietary authentication method.
L0178| 
L0179| 
L0180| 
L0181| 
L0182|  Washington State Liquor and Cannabis Board CCRS Integrator API Guide                                         Page 5
L0183| <PAGEBREAK>Responses and What to Expect
L0184| The API returns standard HTTP status codes. Common cases:
L0185| 
L0186|  Result                            Meaning
L0187|  200 / success                     The file was accepted for processing.
L0188| 
L0189|  400                               The request was malformed or missing required information (e.g. no file, or a
L0190|                                    missing header).
L0191| 
L0192|  401                               Authentication failed - missing, invalid or expired token; a token requested with the
L0193|                                    wrong API identifier (audience); or an uploader email that is not authorized for
L0194|                                    your integrator.
L0195|  500                               An unexpected error occurred and your submission was not accepted. Retry; if the
L0196|                                    problem persists, contact LCB.
L0197| 
L0198|  Rejected file name                A duplicate file name, or a name that doesn't meet the CCRS naming convention.
L0199|  Responses:
L0200| 
L0201|  Success (200)
L0202|  {
L0203|    "success": true,
L0204|    "message": "Your submission was received at <date/time> Pacific Time",
L0205|    "warnings": []
L0206|  }
L0207| 
L0208| 
L0209|  Failure - single reason (400, 401, 500)
L0210|  {
L0211|    "success": false,
L0212|    "error": "Missing required header: X-Uploader-Email"
L0213|  }
L0214| 
L0215| 
L0216|  Failure - one or more files rejected during validation (400)
L0217|  {
L0218|    "success": false,
L0219|    "errors": [ "<reason>", "<reason>" ]
L0220|  }
L0221| 
L0222| Note the two failure shapes: a single "error" string for a rejected request, and an "errors" array when individual
L0223| files fail validation. Handle both.
L0224| 
L0225| Not every 401 includes a JSON body. A missing, malformed, expired or wrong-audience token is rejected before
L0226| the request reaches CCRS. That response has an empty body and a WWW-Authenticate header. Treat any 401
L0227| as an authentication failure rather than relying on a JSON error field being present. A request larger than the
L0228| server limit is likewise rejected before CCRS sees it and returns an HTML error page rather than JSON.
L0229| 
L0230| Acceptance means the file was received for processing, not that every row passed validation. Downstream
L0231| processing validates the data. Please consult the CCRS file specifications to ensure your data is correct.
L0232| 
L0233| 
L0234| 
L0235| 
L0236|  Washington State Liquor and Cannabis Board CCRS Integrator API Guide                                              Page 6
L0237| <PAGEBREAK>Testing and Support
L0238|   • Integrators are responsible for building and testing their own connection and submissions.
L0239|   • CCRS does not provide integration development or debugging support. The requirements and
L0240|     illustrative examples here are provided so you can build and verify your own systems.
L0241| For account provisioning or reporting-requirement questions, please send in a ticket to the LCB ITS
L0242| Service Desk (servicedesk@lcb.wa.gov).
L0243| 
L0244| Common Issues
L0245| Where do we get our credentials?
L0246| M2M accounts are provisioned per the process under “What you need before you start.” Please send in
L0247| a ticket to Service Desk by emailing servicedesk@lcb.wa.gov.
L0248| 
L0249| We can't get an access token.
L0250| Confirm your client ID, client secret, and API identifier (audience) are correct and that you're using the
L0251| standard OAuth 2.0 client-credentials request against the correct token endpoint. Because integrators
L0252| build and operate their own software, troubleshooting your implementation is your responsibility.
L0253| 
L0254| Our submissions are rejected.
L0255| Confirm your token is valid and current, the uploader email header is present and authorized, and your
L0256| files follow the CCRS naming and format specifications.
L0257| 
L0258| 
L0259| 
L0260| 
L0261|  Washington State Liquor and Cannabis Board CCRS Integrator API Guide                                Page 7
L0262| <PAGEBREAK>Glossary
L0263| Term                              Meaning
L0264| M2M account                       A machine-to-machine account your software uses to connect to the
L0265|                                   CCRS API without a person signing in.
L0266| Client ID / secret                The credentials issued with your M2M account, used to authenticate.
L0267| 
L0268| Access token (bearer token)       A temporary credential your software obtains and presents when
L0269|                                   submitting files.
L0270| 
L0271| OAuth 2.0 client credentials      The standard protocol flow used to obtain an access token from a client
L0272|                                   ID + secret.
L0273| 
L0274| Audience (API identifier)         The identifier of the CCRS API for which your token is issued.
L0275| 
L0276| Uploader email                    An authorized email, sent in a request header, on whose behalf a
L0277|                                   submission is made.
L0278| 
L0279| Integrator identifier             A code identifying your integrator, included in each file's name per CCRS
L0280|                                   naming rules.
L0281| 
L0282| 
L0283| 
L0284| 
L0285| Washington State Liquor and Cannabis Board CCRS Integrator API Guide                                  Page 8
L0286| <PAGEBREAK>
```

## 4. Getting Started and Login Guide — verbatim

#### 4.1 Full login guide text (`lcb/login.pdf`)

Source: `lcb/login.txt` L1-L79 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0001| Cannabis Central Reporting System:
L0002| Getting Started and Login Guide
L0003| Updated: August 9, 2024
L0004| 
L0005| 
L0006| The Cannabis Central Reporting System (CCRS) is the cannabis reporting system for
L0007| Washington State. The information below will guide you in accessing CCRS for reporting.
L0008| If you need additional support or experience any issues, contact the LCB IT Helpdesk directly at
L0009| 360-664-1776 or servicedesk@lcb.wa.gov for assistance. LCB is working to ensure issues are
L0010| addressed as quickly as possible.
L0011| 
L0012| 
L0013| How to start:
L0014| Businesses directly accessing CCRS, as well as those utilizing a third party software Integrator,
L0015| must have a Secure Access Washington (SAW) account using a unique email address. SAW is
L0016| a single sign-on application gateway used by the state of Washington to simplify access to
L0017| internet accessible government services.
L0018| Businesses using a third party software integrator will need to access CCRS directly at least
L0019| once to assign their integrator, therefore must have a license administrator with a SAW account.
L0020| 
L0021| 
L0022| Creating a SAW account:
L0023| To create a SAW account navigate to https://secureaccess.wa.gov/. For step-by-step directions
L0024| on creating or accessing your SAW account, see CCRS SAW User Guide available on the
L0025| CCRS Resources page.
L0026| 
L0027| 
L0028| CCRS Portal Access:
L0029| Initially, the only user who will be able to access CCRS to make changes for your business is the
L0030| license administrator. There can only be one license administrator per licensee. The license
L0031| administrator account is set up based on the email address provided to LCB during the licensing
L0032| process. Each assigned license administrator is responsible for setting up additional users in the
L0033| CCRS portal.
L0034| 
L0035| 
L0036| Working with a Third Party Integrator:
L0037| Check with your third party integrator to confirm they are on the LCB’s validated integrator list.
L0038| More information for third party integrators and a list of validated integrators is available on the
L0039| Info for Third Party Integrators page on the LCB site.
L0040| 
L0041| 
L0042| 
L0043| 
L0044|  Washington State Liquor and Cannabis Board           CCRS Getting Started and Login Guide     Page 1
L0045| <PAGEBREAK>Logging in to CCRS:
L0046| 1) The URL https://cannabisreporting.lcb.wa.gov will redirect to Secure Access Washington
L0047|    (SAW) for authentication
L0048|    a) Use your existing SAW account or create a new one to complete this authentication, as
L0049|       outlined in the CCRS SAW User Guide available on the CCRS Resources page
L0050|    b) Reminder that SAW has a different URL (https://secureaccess.wa.gov/), so while
L0051|       authenticating, the URL will not show as LCB (https://cannabisreporting.lcb.wa.gov)
L0052| 2) For the CCRS license administrator
L0053|    a) When logging in for the first time (after signing into SAW for authentication), users are
L0054|       prompted to confirm their CCRS email at the first landing page (see below)
L0055|    b) This email is the one that is associated with the license location(s)
L0056|    c) If you are unsure about the email address associated with your license(s) account, this
L0057|       can be validated with your LCB Licensing Specialist or at LicensingChanges@lcb.wa.gov
L0058|    d) It does not have to be the email that is used for your SAW account
L0059|    e) Only one SAW user can associate as the license admin
L0060|    f) If the incorrect email is entered at this step, or another user in the organization has
L0061|       already completed this step, your account will be locked until you submit a ticket is
L0062|       submitted for assistance at ServiceDesk@lcb.wa.gov
L0063| 
L0064| 3) For additional users added by the license admin
L0065|    a) When logging in for the first time (after signing into SAW for authentication), users are
L0066|       prompted to confirm their CCRS email at the first landing page (see below)
L0067|    b) Additional users enter the email that matches what was used when their CCRS user
L0068|       account was created by the license admin
L0069|    c) If an additional user enters the license admin email instead of their user account at this
L0070|       step, the account may be locked until a ticket is submitted for assistance at
L0071|       ServiceDesk@lcb.wa.gov
L0072| 
L0073| This association step should not occur at subsequent logins.
L0074| 
L0075| 
L0076| 
L0077| 
L0078|  Washington State Liquor and Cannabis Board         CCRS Getting Started and Login Guide    Page 2
L0079| <PAGEBREAK>
```

## 5. License Administrator Guide (Aug 9 2024) — verbatim

#### 5.1 Full text (`lcb/admin-guide.pdf`). This is the ONLY documented control for adding/removing an integrator (Cultivera) from the license.

Source: `lcb/admin-guide.txt` L1-L162 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0001| Cannabis Central Reporting System:
L0002| License Administrator Guide
L0003| Updated: August 9, 2024
L0004| 
L0005| 
L0006| 
L0007| 
L0008| Contents
L0009| Contents ....................................................................................................................... 1
L0010| Make a Payment ........................................................................................................... 2
L0011| Adding Users to License ............................................................................................... 3
L0012| Removing Users from License ...................................................................................... 7
L0013| Manage Approved Integrators ....................................................................................... 9
L0014| 
L0015| 
L0016| 
L0017| 
L0018| Introduction to CCRS License Administration
L0019| This document is intended as a guide for license administrators. As a reminder, there is only one license admin
L0020| per license. This admin is assigned with the license’s official LCB record (using the email of record), not via the
L0021| CCRS interface. This document outlines the steps to make a payment, add additional users, remove these
L0022| users, as well as add and remove integrators to report on a license’s behalf.
L0023| 
L0024| 
L0025| 
L0026| 
L0027|  Washington State Liquor and Cannabis Board                                    CCRS: License Administrator Guide          Page 1
L0028| <PAGEBREAK>Make a Payment
L0029|   1) Navigate to the URL: https://cannabisreporting.lcb.wa.gov
L0030|          a. Select the “Account” drop-down menu
L0031|          b. Select “Licensee”
L0032|   2) This screen will display the list of licenses associated with the email of the license admin.
L0033|          a. Select the “Make a Payment” button
L0034|   3) Follow the instructions for using the payment portal on the LCB Cannabis Tax Reporting page.
L0035| 
L0036| 
L0037| 
L0038| 
L0039| Washington State Liquor and Cannabis Board                       CCRS: License Administrator Guide   Page 2
L0040| <PAGEBREAK>Adding Users to License
L0041| NOTE: Only the license admin may perform this function.
L0042| 
L0043| Licenses will need to add/assign integrators to their record to enable integrators to upload reports on the
L0044| licensee’s behalf.
L0045| 
L0046| 1) Navigate to the URL: https://cannabisreporting.lcb.wa.gov/
L0047|       a. Select the “Account” drop-down menu
L0048|       b. Select “Licensee”
L0049| 
L0050| 
L0051| 
L0052| 
L0053| 2) All licenses associated to the admin user login will be found in this screen
L0054|         a. Select the “Edit” button for the associated license you would like to edit
L0055| 
L0056| 
L0057| 
L0058| 
L0059|  Washington State Liquor and Cannabis Board                           CCRS: License Administrator Guide       Page 3
L0060| <PAGEBREAK>3) List of all approved integrators and approved users is populated
L0061|        a. To add more users:
L0062|                  i. Select the “Manage Users” button beneath the “Approved Users” section
L0063| 
L0064| 
L0065| 
L0066| 
L0067| 4) List of all approved users is populated with option to add new user.
L0068|        a. Select the “Add new user” button
L0069| 
L0070| 
L0071| 
L0072| 
L0073|  Washington State Liquor and Cannabis Board                         CCRS: License Administrator Guide   Page 4
L0074| <PAGEBREAK>5) User Registration
L0075|       a. Fill in requested information
L0076|                 i. Email
L0077|                ii. First Name
L0078|               iii. Last Name
L0079|       b. Select the “Add User” button
L0080| 
L0081| 
L0082| 
L0083| 
L0084|  Washington State Liquor and Cannabis Board   CCRS: License Administrator Guide   Page 5
L0085| <PAGEBREAK>6) List of all approved integrators and approved users is populated with the additional user added
L0086| 
L0087| 
L0088| 
L0089| 
L0090|  Washington State Liquor and Cannabis Board                         CCRS: License Administrator Guide   Page 6
L0091| <PAGEBREAK>Removing Users from License
L0092| NOTE: Only the license admin may perform this function.
L0093| 
L0094| 1) Navigate to the URL: https://cannabisreporting.lcb.wa.gov/
L0095|       a. Select the “Account” drop-down menu
L0096|       b. Select “Licensee”
L0097| 
L0098| 
L0099| 
L0100| 
L0101| 2) All licenses associated to the admin user login will be found in this screen
L0102|         a. Select the “Edit” button for the associated license you would like to edit
L0103| 
L0104| 
L0105| 
L0106| 
L0107|  Washington State Liquor and Cannabis Board                           CCRS: License Administrator Guide   Page 7
L0108| <PAGEBREAK>3) List of all approved integrators and approved users is populated
L0109|        a. To add more users:
L0110|                  i. Select the “Manage Users” button beneath the “Approved Users” section
L0111| 
L0112| 
L0113| 
L0114| 
L0115| 4) List of all approved users is populated with option to delete user(s).
L0116|        a. Select the “Delete” button
L0117| 
L0118| 
L0119| 
L0120| 
L0121|  Washington State Liquor and Cannabis Board                           CCRS: License Administrator Guide   Page 8
L0122| <PAGEBREAK>Manage Approved Integrators
L0123| NOTE: Only the license admin may perform this function.
L0124| 
L0125| 1) Navigate to the URL: https://cannabisreporting.lcb.wa.gov/
L0126|       a. Select the “Account” drop-down menu
L0127|       b. Select “Licensee”
L0128| 
L0129| 
L0130| 
L0131| 
L0132| 2) All licenses associated to the admin user login will be found in this screen
L0133|         a. Select the “Edit” button for the associated license you would like to edit.
L0134| 
L0135| 
L0136| 
L0137| 
L0138|  Washington State Liquor and Cannabis Board                            CCRS: License Administrator Guide   Page 9
L0139| <PAGEBREAK>3) List of all approved integrators and approved users is populated
L0140|        b. To manage integrators:
L0141|                  i. Select the “Manage Integrators” button beneath the “Approved Integrators” section
L0142| 
L0143| 
L0144| 
L0145| 
L0146| Washington State Liquor and Cannabis Board                         CCRS: License Administrator Guide    Page 10
L0147| <PAGEBREAK>4) List of all approved integrators is populated
L0148|                  ii. Select the corresponding checkbox to the left for one, none, or multiple approved integrators
L0149|                 iii. Select the “Update” button to submit the update
L0150|                 iv. Select “Cancel” to close out screen without update
L0151| 
L0152| 
L0153| 
L0154| 
L0155| Washington State Liquor and Cannabis Board                           CCRS: License Administrator Guide    Page 11
L0156| <PAGEBREAK>5) Once updated your list of approved integrators will reflect the choices made on the previous screen
L0157| 
L0158| 
L0159| 
L0160| 
L0161| Washington State Liquor and Cannabis Board                        CCRS: License Administrator Guide      Page 12
L0162| <PAGEBREAK>
```

## 6. SAW User Guide (Aug 9 2024) — verbatim

#### 6.1 Full text (`lcb/saw-guide.pdf`). Superseded by WA.gov in October 2026 per FAQ; keep for the transition window.

Source: `lcb/saw-guide.txt` L1-L56 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0001| Secure Access Washington (SAW) User Guide
L0002| Updated August 9, 2024
L0003| 
L0004| Logging into SAW:
L0005| Step 1: Navigate to https://cannabisreporting.lcb.wa.gov (do not log directly into SAW). This will
L0006| automatically redirect you to Secure Access Washington (SAW), where you will either:
L0007| 
L0008|    •   Sign into your active SAW account
L0009|           o Enter Username and Password
L0010|                    This will then redirect you back to the CCRS Portal.
L0011|    Or
L0012|    • Create a new account by selecting the ‘SIGN UP!’ button. Follow the steps below when
L0013|       creating a SAW account.
L0014| 
L0015| 
L0016| 
L0017| 
L0018|    •   NOTE: If you have previously had a SAW account but don’t remember your username or
L0019|        password, you will be able to reset them on the welcome screen shown above.
L0020| 
L0021| 
L0022| 
L0023| 
L0024| Washington State Liquor and Cannabis Board                                SAW User Guide Page 1
L0025| <PAGEBREAK>Creating an Account:
L0026| Step 2: Once you have selected the ‘SIGN UP!’ button, you will be asked to enter your personal
L0027| information which will include a username and password. You will want to remember your
L0028| username and password for future log-on.
L0029| 
L0030| 
L0031| 
L0032| 
L0033| Washington State Liquor and Cannabis Board                             SAW User Guide Page 2
L0034| <PAGEBREAK>Activating your account:
L0035| Step 3: Once you have completed your personal information and created a username and
L0036| password, you will receive an activation link to the email that you entered as your primary email.
L0037| You will need to click the link in the email you receive to activate your account and proceed to
L0038| the log-in page for the CCRS portal.
L0039| 
L0040| 
L0041| 
L0042| 
L0043| Logging into the CCRS Portal:
L0044| Step 4: Once you reach the confirmation screen, navigate past the sign up screen by clicking
L0045| the “X” in the top right corner, where you will return to the SAW login screen. For more detailed
L0046| information on logging in to CCRS, refer to the Getting Started and Login Guide, which is
L0047| available on the CCRS Resources page.
L0048| 
L0049| If you are not redirected to the CCRS portal, but are logged into SAW, please close your
L0050| browser and navigate to https://cannabisreporting.lcb.wa.gov to login in the correct manner.
L0051| 
L0052| 
L0053| 
L0054| 
L0055| Washington State Liquor and Cannabis Board                                SAW User Guide Page 3
L0056| <PAGEBREAK>
```

## 7. Transportation Manifests page — verbatim (https://lcb.wa.gov/ccrs/manifests)

#### 7.1 Full text. Retailers do not file Manifest.csv (Table 1) but RECEIVE the CCRS-generated manifest PDF; its item rows carry the vendor's InventoryExternalIdentifier that becomes FromInventoryExternalIdentifier in InventoryTransfer.csv.

Source: `lcb/manifests.txt` L1-L207 (1-based). Form-feeds (`\f`) mark PDF page breaks.

```text
L0001| SOURCE: https://lcb.wa.gov/ccrs/manifests
L0002| Transportation Manifests
L0003| Please note the contingency manifest is no longer available.
L0004| The only accepted version is the CCRS Manifest. Currently CCRS is generating an error message with a successful submitted and processed manifest. If you receive a success message and PDF attached, the error message for the same manifest can be ignored. If you receive just an error message, there is an error on the manifest.csv. Please contact examiner@lcb.wa.gov with any questions.
L0005| Transportation of cannabis products in the state of Washington requires submission of the official transportation manifest provided by the LCB.
L0006| Manifest.CSV
L0007| CCRS Transportation Manifest User Guide
L0008| General Information About Submitting Manifest Reports
L0009| Download a PDF version of this guide: CCRS Transportation Manifest User Guide
L0010| The manifest report is uploaded to CCRS as a .CSV file. You can find the Manifest.CSV template above. The information in the manifest file has dependencies on other report data, creating an order of operations. Be sure to save the spreadsheet as a .CSV file with the proper naming convention before attempting to upload the data as detailed below.
L0011| The naming convention for uploaded files are as follows, using the respective upload file type name:
L0012| Licensees: manifest_LicenseNumber_YYYYMMDDHHMMSS
L0013| Integrators: manifest_IntegratorID_YYYYMMDDHHMMSS
L0014| To upload the .CSV files created, navigate to https://cannabisreporting.lcb.wa.gov/ and log in as outlined in the Getting Started and Login Guide on the CCRS Resources Page, then follow the upload instructions outlined in this document.
L0015| If there is an error with your upload, an email will be sent letting you know. Upon upload of a successful manifest file, an email will be generated with an attached PDF of the Manifest Report. The sending licensee, receiving licensee, the integrator (if appropriate) and transporter (if appropriate) will all receive confirmation emails.
L0016| File Dependencies and Order of Operations
L0017| The manifest file is dependent on the successful upload of other CCRS records. The manifest will only be generated when the dependent data elements are present in CCRS. The order of operations and the dependent data elements that must be upload and accepted by CCRS prior to uploading a manifest file are as follows:
L0018| Associated Strain, Area, and Product files are required for Inventory and Plant files.
L0019| Associated Inventory and Plant files are required for Manifest files.
L0020| The manifest file will not successfully upload and be accepted by the system if the prerequisite records containing the items on the manifest are not completed before attempting to create the manifest.
L0021| Manifest Report File Header Attributes
L0022| The manifest file is unique among the CCRS file uploads in the amount of information contained in the header. The additional data required in the manifest file is specific to the physical transportation of the cannabis product. It is important to ensure the details are accurate when entering this information, as inaccurate information can lead to complications if the manifest comes under review by law enforcement.
L0023| SubmittedBy (user submitting the report)
L0024| Data Field Type (character limit): text (35)
L0025| Required for operation type: Insert, Update and Delete
L0026| SubmittedDate (date the user is submitting the records)
L0027| Data Field Type: date (MM/DD/YYYY)
L0028| Required on which operations: Insert, Update and Delete
L0029| NumberRecords (number of records listed below the field names)
L0030| Note: This number must match the number of records or the file will fail to process
L0031| Data Field Type: Numeric
L0032| Required on which operations: Insert, Update and Delete
L0033| ExternalManifestIdentifier (assigned identifier for the manifest list of items being transported)
L0034| Note: This identifier applies to the header, and is for the entire manifest
L0035| Data Field Type (character limit): Text (100)
L0036| Required on which operations: Insert, Update and Delete
L0037| Valid Values:Must be a unique manifest identifier - one that is not in CCRS system, whether the order has been cancelled or not
L0038| Error Messages:ExternalManifestIdentifier is required
L0039| Duplicate ExternalManifestIdentifier
L0040| This the Unique Identifier found on the COA to represent the COA (Test Results)
L0041| HeaderOperation (nature of the entry the database will make for the manifest header)
L0042| Data Field Type (character limit): Text (35)
L0043| Required on which operations: Insert, Update and Delete
L0044| Valid Values:Insert (create new record with a unique external identifier)
L0045| Update (alter an existing record indicated by external identifier)
L0046| Delete (delete a record indicated by external identifier)\
L0047| Error Messages:HeaderOperation is required
L0048| Invalid HeaderOperation
L0049| ExternalManifestIndentifier does not exist in CCRS, cannot update or delete
L0050| Cannot perform entered HeaderOperation, Manifest has already been deleted
L0051| TransportationType (type of transportation arrangement in place for the manifest)
L0052| Data Field Type: Text (use exact valid values)
L0053| Required on which operations: Insert and Update
L0054| Valid Values:Regular (the originating licensee transporting to the receiving licensee)
L0055| Pick-up (the receiving licensee retrieving from the originating licensee)
L0056| Transporter Licensee (a licensed third party transporting from the originating licensee to the receiving licensee)
L0057| Error Messages:TransportationType is required
L0058| Invalid TransportationType
L0059| OriginLicenseNumber (state assigned licensee ID number of the originating licensed facility)
L0060| Data Field Type (character limit): Numeric (10)
L0061| Required on which operations: Insert and Update
L0062| Error Messages:Invalid OriginLicenseNumber
L0063| OriginLicenseNumber is required
L0064| OriginLicenseNumber must be numeric
L0065| OriginLicenseNumber is not assigned to integrator
L0066| LicenseNumber in the file name must match OriginLicenseNumber
L0067| NOTE: Integrators should not receive this error
L0068| OriginLicenseePhone (phone number of the originating state licensed facility)
L0069| Data Field Type (character limit): Text (14)
L0070| Required on which operations: Insert and Update
L0071| Error Messages:OriginLicenseePhone is required
L0072| OriginLicenseePhone must not exceed 14 characters
L0073| OriginLicenseeEmailAddress (email address of the originating state licensed facility)
L0074| Data Field Type (character limit): Text (250)
L0075| Required on which operations: Insert and Update
L0076| Error Messages:OriginLicenseeEmail is required
L0077| TransportationLicenseNumber (state assigned licensee ID number of the transporting business)
L0078| Data Field Type (character limit): Numeric (10)
L0079| Required on which operations: Insert and Update
L0080| Note: Conditionally required only if Transportation Type = TransporterLicensee
L0081| Error Messages:Invalid TransportationLicenseNumber
L0082| TransportationLicenseNumber is required If Transportation Type is Transporter Licensee
L0083| TransportationLicenseNumber must be Numeric
L0084| TransportationLicenseNumber cannot be submitted for Regular or Pick-up TransportationType
L0085| DriverName (name of the licensed driver operating the transporting vehicle)
L0086| Data Field Type (character limit): Text (75)
L0087| Required on which operations: Insert and Update
L0088| Error Messages:Invalid DriverName
L0089| DriverName is required
L0090| DepartureDateTime (estimated date and time of departure)
L0091| Data Field Type: date/time (MM/DD/YYYY hh:mm AM/PM)
L0092| Note: The hour:minute are in 12 hour (AM/PM) format
L0093| Required on which operations: Insert and Update
L0094| Error Messages:Invalid DepartureDateTime format
L0095| DepartureDateTime is required
L0096| ArrivalDateTime (estimated date and time of arrival)
L0097| Data Field Type: date/time (MM/DD/YYYY hh:mm AM/PM)
L0098| Note: The hour:minute are in 12 hour (AM/PM) format
L0099| Required on which operations: Insert and Update
L0100| Error Messages:Invalid ArrivalDateTime format
L0101| ArrivalDateTime is required
L0102| VIN # (Vehicle Identification Number of the transporting vehicle)
L0103| Data Field Type (character limit): Text (50)
L0104| Required on which operations: Insert and Update
L0105| Error Messages:Invalid VIN #
L0106| VIN # is required
L0107| VehiclePlateNumber (license plate number of the transporting vehicle)
L0108| Data Field Type (character limit): Text (7)
L0109| Required on which operations: Insert and Update
L0110| Error Messages:Invalid VehiclePlateNumber
L0111| VehiclePlateNumber is required
L0112| VehicleModel (model name of the transporting vehicle)
L0113| Data Field Type (character): Text (25)
L0114| Required on which operations: Insert and Update
L0115| Error Messages:Invalid VehicleModel
L0116| VehicleModel is required
L0117| VehicleMake (manufacturer name of the transporting vehicle)
L0118| Data Field Type (character): Text (25)
L0119| Required on which operations: Insert and Update
L0120| Error Messages:Invalid VehicleMake
L0121| VehicleMake is required
L0122| VehicleColor (color of the transporting vehicle)
L0123| Data Field Type (character limit): Text (15)
L0124| Required on which operations: Insert and Update
L0125| Error Messages:Invalid VehicleColor
L0126| VehicleColor is required
L0127| DestinationLicenseNumber (state assigned licensee ID number of the receiving licensed facility)
L0128| Data Field Type (character limit): Numeric (10)
L0129| Required on which operations: Insert and Update
L0130| Error Messages:Invalid DestinationLicenseNumber
L0131| DestinationLicenseNumber is required
L0132| DestinationLicenseNumber must be Numeric
L0133| DestinationLicenseePhone (phone number of the receiving state licensed facility)
L0134| Data Field Type (character limit): Text (14)
L0135| Required on which operations: Insert and Update
L0136| Error Messages:DestinationLicenseePhone is required
L0137| DestinationLicenseePhone must not exceed 14 characters
L0138| DestinationLicenseeEmailAddress (email address of the receiving WA state licensed facility)
L0139| Data Field Type (character limit): Text (250)
L0140| Required on which operations: Insert and Update
L0141| Error Messages:DestinationLicenseeEmailAddress is required
L0142| Manifest Report File Data Fields
L0143| The data filed on the Manifest report reflect the individual items being transported. The plant and inventory external identifiers do make a data validation check to the CCRS database, so the respective inventory item or plant entry must exist in order to successfully report on the transportation manifest.
L0144| InventoryExternalIdentifier (alpha-numeric identifier assigned by the originating licensee to the inventory item being transported)
L0145| Data Field Type (character limit): Text (100)
L0146| Required on which operations: Insert, Update and Delete
L0147| Valid Values: This must be a previously reported inventory item external identifier if the manifest item is an inventory item
L0148| Error Messages:Invalid InventoryExternalIdentifier
L0149| InventoryExternalIdentifier is Required ONLY if PlantExternalIdentifier is not entered
L0150| Each item can have either the InventoryExternalIdentifier or PlantExternalIdentifier - both identifiers cannot be entered for the same Item
L0151| PlantExternalIdentifier (alpha-numeric identifier assigned by the originating licensee to the plant being transported)
L0152| Data Field Type (character limit): Text (100)
L0153| Required on which operations: Insert, Update and Delete
L0154| Valid Values: This must be a previously reported plant external identifier if the manifest item is an plant
L0155| Error Messages:Invalid plantExternalIdentifier
L0156| PlantExternalIdentifier is Required ONLY if InventoryExternalIdentifier is not Entered
L0157| Each item can have either the InventoryExternalIdentifier or PlantExternalIdentifier - both identifiers cannot be entered for the same Item
L0158| Quantity (quantity of inventory transferred from origin to destination)
L0159| Data Field Type (character limit): decimal (10,2)
L0160| Required on which operations: Insert, Update and Delete
L0161| Error Messages:Quantity is required
L0162| Quantity must be numeric
L0163| Only 2 Decimal places are allowed
L0164| UOM (defines unit of measurement as by weight or by count)
L0165| Data Field Type (character limit): Text (4)
L0166| Required on which operations: Insert, Update and Delete
L0167| Accepted Values: • Each • Gram
L0168| Error Messages:UOM is required
L0169| Invalid UOM
L0170| WeightPerUnit (defines the weight of each individual unit accounted for in Quantity field entry)
L0171| Data Field Type (character limit): decimal (10,2)
L0172| Required on which operations: Insert, Update and Delete
L0173| Note: Conditionally required only if InventoryExternalIdentifer is entered
L0174| Error Messages:WeightPerUnit is required if InventoryExternalIdentifier is entered
L0175| WeightPerUnit must be numeric, only 2 decimal places are allowed
L0176| WeightPerUnit cannot be submitted for Plants
L0177| ServingsPerUnit (defines the number of servings in each individual unit accounted for in Quantity field entry)
L0178| Data Field Type (character limit): decimal (10,2)
L0179| Required on which operations: Insert, Update and Delete
L0180| Note: Conditionally required only if InventoryExternalIdentifer is entered
L0181| Error Messages:ServingsPerUnit is required if InventoryExternalIdentifier is Entered
L0182| ServingsPerUnit must be numeric, only 2 decimal places are allowed
L0183| ServingsPerUnit cannot be submitted for Plants
L0184| ExternalIdentifier (assigned identifier for the manifest list of items being transported)
L0185| Note: This identifier applies to the individual item within the manifest
L0186| Data Field Type (character limit): Text (100)
L0187| Required: optional
L0188| LabTestExternalIdentifier (Unique identifier found to represent the COA [Test Results])
L0189| Example: COA_01
L0190| Data Field Type (character limit): Text (100)
L0191| Required on which operations: Insert, Update and DeleteNote: only required on manifests to retail licenses for product type “End Product”
L0192| Error Messages:Lab Test External ID required if End Product
L0193| CreatedBy (user who initially created the record)
L0194| Data Field Type (character limit): Text (35)
L0195| CreatedDate (the date that the record was first submitted)
L0196| Data Field Type: Date (MM/DD/YYYY)
L0197| UpdatedBy (user who subsequently updated a record)
L0198| Data Field Type (character limit): Text (35)
L0199| UpdatedDate (the date that the record was modified)
L0200| Data Field Type: Date (MM/DD/YYYY)
L0201| Operation (nature of the entry the database will make for the record)
L0202| Valid Values:Insert (create new record with a unique external identifier)
L0203| Update (alter an existing record indicated by external identifier)
L0204| Delete (delete a record indicated by external identifier)
L0205| Example Transportation Manifest.CSV
L0206| Example Transportation Manifest
L0207| 
```

## 8. Official CSV templates — byte-exact (https://lcb.wa.gov/ccrs/resources)

Downloaded 2026-09-15. Each file is CRLF-terminated. Shown with `<CR>` markers so trailing-comma padding on the three header rows is visible. **Compare against `assembleCcrsFile` (`src/lib/compliance/ccrs-batch-core.ts` L632-L660) which emits `SubmittedBy,<value>` with NO padding — see Part 12 U-03.**

#### 8.Area.csv

```text
R1| SubmittedBy,,,,,,,,<CR>
R2| SubmittedDate,,,,,,,,<CR>
R3| NumberRecords,,,,,,,,<CR>
R4| LicenseNumber,Area,IsQuarantine,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation<CR>
```

Column count (row 4): **9**. Columns: `LicenseNumber`, `Area`, `IsQuarantine`, `ExternalIdentifier`, `CreatedBy`, `CreatedDate`, `UpdatedBy`, `UpdatedDate`, `Operation`.

#### 8.Inventory.csv

```text
R1| SubmittedBy,,,,,,,,,,,,,<CR>
R2| SubmittedDate,,,,,,,,,,,,,<CR>
R3| NumberRecords,,,,,,,,,,,,,<CR>
R4| LicenseNumber,Strain,Area,Product,InitialQuantity,QuantityOnHand,TotalCost,IsMedical,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation<CR>
```

Column count (row 4): **14**. Columns: `LicenseNumber`, `Strain`, `Area`, `Product`, `InitialQuantity`, `QuantityOnHand`, `TotalCost`, `IsMedical`, `ExternalIdentifier`, `CreatedBy`, `CreatedDate`, `UpdatedBy`, `UpdatedDate`, `Operation`.

#### 8.InventoryAdjustment.csv

```text
R1| SubmittedBy,,,,,,,,,,,<CR>
R2| SubmittedDate,,,,,,,,,,,<CR>
R3| NumberRecords,,,,,,,,,,,<CR>
R4| LicenseNumber,InventoryExternalIdentifier,AdjustmentReason,AdjustmentDetail,Quantity,AdjustmentDate,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation<CR>
```

Column count (row 4): **12**. Columns: `LicenseNumber`, `InventoryExternalIdentifier`, `AdjustmentReason`, `AdjustmentDetail`, `Quantity`, `AdjustmentDate`, `ExternalIdentifier`, `CreatedBy`, `CreatedDate`, `UpdatedBy`, `UpdatedDate`, `Operation`.

#### 8.InventoryTransfer.csv

```text
R1| SubmittedBy,,,,,,,,,,,<CR>
R2| SubmittedDate,,,,,,,,,,,<CR>
R3| NumberRecords,,,,,,,,,,,<CR>
R4| FromLicenseNumber,ToLicenseNumber,FromInventoryExternalIdentifier,ToInventoryExternalIdentifier,Quantity,TransferDate,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation<CR>
```

Column count (row 4): **12**. Columns: `FromLicenseNumber`, `ToLicenseNumber`, `FromInventoryExternalIdentifier`, `ToInventoryExternalIdentifier`, `Quantity`, `TransferDate`, `ExternalIdentifier`, `CreatedBy`, `CreatedDate`, `UpdatedBy`, `UpdatedDate`, `Operation`.

#### 8.Product.csv

```text
R1| SubmittedBy,,,,,,,,,,,<CR>
R2| SubmittedDate,,,,,,,,,,,<CR>
R3| NumberRecords,,,,,,,,,,,<CR>
R4| LicenseNumber,InventoryCategory,InventoryType,Name,Description,UnitWeightGrams,ExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation<CR>
```

Column count (row 4): **12**. Columns: `LicenseNumber`, `InventoryCategory`, `InventoryType`, `Name`, `Description`, `UnitWeightGrams`, `ExternalIdentifier`, `CreatedBy`, `CreatedDate`, `UpdatedBy`, `UpdatedDate`, `Operation`.

#### 8.Sales.csv

```text
R1| SubmittedBy,,,,,,,,,,,,,,,,,<CR>
R2| SubmittedDate,,,,,,,,,,,,,,,,,<CR>
R3| NumberRecords,,,,,,,,,,,,,,,,,<CR>
R4| LicenseNumber,SoldToLicenseNumber,InventoryExternalIdentifier,PlantExternalIdentifier,SaleType,SaleDate,Quantity,UnitPrice,Discount,RetailSalesTax,CannabisExciseTax,SaleExternalIdentifier,SaleDetailExternalIdentifier,CreatedBy,CreatedDate,UpdatedBy,UpdatedDate,Operation<CR>
```

Column count (row 4): **18**. Columns: `LicenseNumber`, `SoldToLicenseNumber`, `InventoryExternalIdentifier`, `PlantExternalIdentifier`, `SaleType`, `SaleDate`, `Quantity`, `UnitPrice`, `Discount`, `RetailSalesTax`, `CannabisExciseTax`, `SaleExternalIdentifier`, `SaleDetailExternalIdentifier`, `CreatedBy`, `CreatedDate`, `UpdatedBy`, `UpdatedDate`, `Operation`.

#### 8.Strain.csv

```text
R1| SubmittedBy,,,,<CR>
R2| SubmittedDate,,,,<CR>
R3| NumberRecords,,,,<CR>
R4| LicenseNumber,Strain,StrainType,CreatedBy,CreatedDate<CR>
```

Column count (row 4): **5**. Columns: `LicenseNumber`, `Strain`, `StrainType`, `CreatedBy`, `CreatedDate`.

## 9. Environments and endpoints (collected, each with its source)

| Item | Value | Source |
|---|---|---|
| Production portal | https://cannabisreporting.lcb.wa.gov | [G] p.3 step 1; [ADMIN] 'Make a Payment' step 1; [SAW] step 1 |
| PREproduction portal | https://precannabisreporting.lcb.wa.gov | [API L0070] "(Pre-Production) precannabisreporting.lcb.wa.gov"; also [API L0074] |
| PREprod availability | 'The LCB provides all cannabis licensees, labs and integrators access to the PREproduction CCRS environment for training and testing.' | [FAQ] Integrators Q1 |
| PREprod isolation | 'These environments are autonomous and do not share administration or reporting data.' | [FAQ] Integrators Q5 |
| Login (now) | SecureAccess Washington (SAW) via the portal URL, never directly | [SAW] step 1 |
| Login (Oct 2026 →) | WA.gov; 'All users need to manually set up a new account.' https://manage.login.wa.gov/create/enter-email.html | [FAQ] WA.gov Transition |
| Examiners | examiner@lcb.wa.gov (send CSV + forwarded error email) | [FAQ] Data Quality Q3 |
| Licensing admin email change | customerservicelicensing@lcb.wa.gov from current admin email | [FAQ] General |
| Integrator API token (PREprod) | https://test-login.wa.gov/oauth/token, audience lcb.ccrs.api.pre | [API] |
| Integrator API token (prod) | https://www.login.wa.gov/oauth/token, audience lcb.ccrs.api.prod | [API] |
| Integrator API upload | POST /api/v1/upload multipart `files=@…`, headers Authorization: Bearer, X-Uploader-Email | [API] |
| File size | '≤1GB' recommended, 2GB accepted | [FAQ] Data Quality Q2 |
| Reporting week | 'Sunday - Saturday … expected by no later than Sunday for the previous week. Reporting more frequently than weekly is allowed.' | [FAQ] Data Reporting |
| Filename time zone | 'the file name should be referenced in PST' | [FAQ] General |

