-- 0058_merge_pluggy_reissued_duplicates.sql
--
-- Mickael, 2026-10-15, after reviewing private/review/2026-10-15-duplicados.csv:
-- "Mark the 190 as duplicates, re-link the 7, keep the 6 check-by-hand rows."
--
-- WHY. Pluggy sometimes gives the SAME bank row a NEW transaction id (card
-- instalments re-dated when a bill closes; the old Itaú connection vs
-- MeuPluggy). The sync dedups only on that id, so the app kept the old copy
-- AND inserted the new one. Measured 2026-10-15 against Pluggy's live list
-- from 2026-06-01: 203 app rows whose id Pluggy no longer returns. Of those,
-- 190 have a living copy (same account + amount, and either the same
-- instalment text or within 5 days): 118 past non-transfer rows = R$84.553,45
-- double-counted, 64 future instalments = R$21.806,83, 8 transfers.
--
-- WHAT. The app has no "duplicate" flag, so this follows 0037: the old copy is
-- moved to a backup table and removed from the ledger. But 178 of the 190 old
-- copies carry Mickael's hand review (status user_edited/user_confirmed) and
-- the living copy does not. So BEFORE removing anything, the review is carried
-- onto the living copy:
--   1. category, shared amount, transfer flag, status, notes (from the most
--      reviewed old copy, only when that copy was reviewed)
--   2. receipt-search stamps, when the living copy was never searched
--   3. reimbursement tags and Gmail receipts (copied, never overwritten)
--   4. nota fiscal / merchant-rule pointers moved to the living copy
--   5. old copies removed (their tags/receipts were backed up first)
-- Then 7 rows that are the same purchase under a new Pluggy id get the new id
-- (nothing else changes), so the next sync recognises them.
-- The 6 check-by-hand rows are not in either list and are left alone.
--
-- REVERSIBLE: every touched row is copied first; rollback SQL is at the bottom.

begin;

create table dup_0058_pairs (ghost uuid primary key, twin uuid not null);
insert into dup_0058_pairs (ghost, twin) values
-- dup(ghost_id, twin_id)
('e1827221-261a-48ba-835e-6a17f3a68738'::uuid,'c460577b-e94b-42ad-af88-c02a0185f137'::uuid),
('63cbd949-e6e2-4890-84ec-3a60697de115'::uuid,'3a68f169-65f1-414d-9ef2-246c4fedae85'::uuid),
('2cec9ed2-2b15-4b5d-b88c-8d03738af963'::uuid,'88db2e49-adab-4c23-89d3-1008f7a88181'::uuid),
('87302d57-2e06-4d0e-8b3d-83a6705bc412'::uuid,'47586d90-e032-4262-8b04-8b8de4cfaba3'::uuid),
('367414cf-9b26-4ef4-9c31-21920aedef92'::uuid,'7deb3f5a-3b07-424e-b847-622eb46ea4e6'::uuid),
('a19083c9-671e-4817-a730-8a8082672d90'::uuid,'1dacb238-e233-4204-9d96-42979ce82602'::uuid),
('51db277f-5d83-4cce-a6e9-9e0f21db45b6'::uuid,'eb772196-0736-4813-9cf2-a6c5171b14cb'::uuid),
('600ebcd7-6ba1-4c2a-a37a-94efb89fadbc'::uuid,'66ff6cb9-5aef-4d6f-8f89-6ebe7e6a3147'::uuid),
('f9020b86-0261-48c3-bb71-4914bce447ef'::uuid,'65f78524-bd27-450e-a4a1-f474d8b8d515'::uuid),
('946b5f9c-25ad-4687-b4ed-28952b62394d'::uuid,'097d9b95-f8c9-4460-a8f6-373d82ff2516'::uuid),
('281f7594-8397-4571-92da-3cbebaa43cc7'::uuid,'943cd57f-6c12-4173-9305-712b526da18d'::uuid),
('6acf5e9a-8980-426d-84b7-420568867b9c'::uuid,'f1319c95-20fb-4ce6-bd91-0a5043d86d22'::uuid),
('5d5ee306-a823-470b-ac07-aebaef721939'::uuid,'78b33f1f-6d55-4b07-801c-153d09db962a'::uuid),
('7edf069d-e304-4958-9e32-cb63a08d594d'::uuid,'3362e49a-527e-4bc8-a685-bb66c7ddedff'::uuid),
('54ab7fac-fa37-49b4-95d5-a022ff41478c'::uuid,'dfb939dc-4d7f-4db8-9307-8eaacc24c625'::uuid),
('3edb75b4-17f2-4e31-af9e-8306c28afc0c'::uuid,'1f81fe68-64be-47c9-9cb8-2835b52e9f15'::uuid),
('abf87da7-54ad-481e-867a-7ba36ef37c7c'::uuid,'961998ee-64f6-43b2-88d6-3f7f799d77d9'::uuid),
('ee9cba8d-da50-4e3d-8660-dd0b61e5484d'::uuid,'12e2cdda-fdd7-42e3-a5e3-c2b16130fc27'::uuid),
('cf6cf5db-70f6-4c6e-9a11-fda45ceef30e'::uuid,'5e42d78c-4eb1-46af-bcec-9a0353a9160d'::uuid),
('ba0cb1bd-281c-451e-b558-28ddfeb6a150'::uuid,'2b0e5c75-b55f-444c-812d-47a3080b49a4'::uuid),
('86912d57-58b0-439a-a14c-d75584955a4d'::uuid,'45cb6d03-108b-41ed-a4a0-5c1f5388a011'::uuid),
('1117a4d8-be38-4433-bb79-db0b73bb1c57'::uuid,'73df5b25-3b77-4475-b9af-81052902a44a'::uuid),
('f0dd762b-1f64-4e98-9dae-bb1f59279270'::uuid,'e4f9ca03-e063-45f4-a38a-a47907681c6c'::uuid),
('3d9a518b-26d8-4dd8-8c8d-020051bc44e7'::uuid,'14a3924e-5033-4ae6-89ff-034a40977da8'::uuid),
('4a3300a8-ac49-422d-8ddb-b7a0b42c7023'::uuid,'48d250ff-288d-484f-8044-eae0125e9655'::uuid),
('625b0861-50e2-4cf4-839b-47b380445c53'::uuid,'23d4390b-a33a-474f-a0b1-7a74b6fa20e6'::uuid),
('e9febe53-dc3b-485b-b1c6-bcde5e46819c'::uuid,'e1e50991-25c3-43ce-9ef0-16e1f4a5c91a'::uuid),
('8984ecd1-d74a-4072-807b-6a5692e5b00c'::uuid,'bd16e78f-f6a0-4839-b71e-813e08df917a'::uuid),
('2d9386c4-443a-4957-b00e-98a80a1cd7bb'::uuid,'fa51646e-d7bd-4352-bbc1-9020fd5da71d'::uuid),
('3eee380c-4dde-4e1a-b17e-871f0d8e57f2'::uuid,'751888fc-f5c2-4488-bb44-9b7ff5b60ed5'::uuid),
('86047633-0b10-4ff3-b2d1-8811eaa2ade5'::uuid,'3c2eefa5-5134-464f-a903-c841378955b2'::uuid),
('3c773550-28a1-4cdc-8868-b718a84a53e7'::uuid,'6764c42a-4742-4f08-bbc0-91a054041914'::uuid),
('fe812669-05a9-416c-ad77-d72ac7a3ca25'::uuid,'3e227967-78ad-41f6-9e1e-1898dd06114e'::uuid),
('7f6a1b8c-28f8-42b8-9e9e-77e7124977f7'::uuid,'7f3f1656-1246-4689-b736-9e1c1f4e361d'::uuid),
('5f148aaf-4e2b-4bb1-86b9-064fd266d1de'::uuid,'1028259c-ce27-4b29-9eaf-3d0f815790ca'::uuid),
('99227969-28dd-49e7-88c5-0a896c1e6de1'::uuid,'304565d8-1c7b-415b-aa8e-46b8ca109726'::uuid),
('e8a1468b-539b-4c29-b581-64628ebe49ba'::uuid,'59cd9e05-b38d-4f04-a2b8-0d868056aa47'::uuid),
('740fbc0c-c322-4749-9c1e-01818a958da7'::uuid,'bc00db7a-b784-481a-bb2c-707ba702c856'::uuid),
('833566a2-858d-4297-a3df-5680cc4ffb4b'::uuid,'c4e7dae8-2b9e-48ea-b2b7-febf33cb4314'::uuid),
('acaf7daf-c1fa-43c0-bebd-c160a02a5bd6'::uuid,'80eed874-307e-4c90-946f-4c7d52277b2d'::uuid),
('9fa44b25-4bbc-4c45-963f-0dd5ca189abd'::uuid,'68727548-1964-413e-8d38-1f2895a7cc9d'::uuid),
('c289c895-133d-4e78-9fa2-22f602d41d53'::uuid,'2c14bc47-cc04-4273-b0f3-565ccceddbe1'::uuid),
('26ca40ee-9fd7-4d86-8a02-bfa2772506e2'::uuid,'fd8cf718-6196-422b-985e-ce0586c33c9d'::uuid),
('ab07a5d5-cadb-4a75-b541-31ea6e7216a8'::uuid,'9d2608d2-29c7-4d15-893f-71a646606459'::uuid),
('f83609b3-4c1a-43d9-b712-f0564b09c88d'::uuid,'0eb29c3e-3afb-4660-ba5b-d5a57ebeeb53'::uuid),
('26dc61aa-6a93-4b2f-8682-4752b484576f'::uuid,'27504d52-4c64-415a-b3d0-7a152f832990'::uuid),
('e7c14b91-9714-4a55-ba20-f210dda224f2'::uuid,'60defb56-f15e-4235-9ba0-8b092dcd67c7'::uuid),
('b62c303e-83e2-4343-9de8-867d65b35477'::uuid,'f7d79c68-e17c-4781-9762-59bc655081cc'::uuid),
('6c37b25c-0e3b-4a91-bd7d-c9aca8f87de8'::uuid,'8b56e862-cc62-4bdc-b548-cec4277aab41'::uuid),
('1c1879ba-8018-4068-abf9-5b01fc100065'::uuid,'ea426625-7d9e-4506-bcfc-98d54ad89117'::uuid),
('e2fe62fe-6907-4930-9dfb-e946cae6fa7c'::uuid,'ff981e03-9235-49fa-9b5b-65ad102866a7'::uuid),
('eff95657-e309-415a-906c-00d51ef225df'::uuid,'0a93cb74-3fb9-4dfa-a006-d1f1649026af'::uuid),
('087f2a5e-18df-458f-982c-5f3593ca11f8'::uuid,'2c14bc47-cc04-4273-b0f3-565ccceddbe1'::uuid),
('90735dff-ae6c-4997-aabc-6ccf4fad6ddb'::uuid,'5ca84ff8-b337-440b-91fc-0d83a81a6045'::uuid),
('c85fec12-12f1-4559-b4fe-4e46910daec4'::uuid,'27713bbb-0120-4b10-9876-471d6e8f724b'::uuid),
('9f73c4e9-a558-45b4-a662-bec3b6d916c2'::uuid,'fd8cf718-6196-422b-985e-ce0586c33c9d'::uuid),
('3b97dea0-8b7e-4761-b822-b40cbeeb9652'::uuid,'9d2608d2-29c7-4d15-893f-71a646606459'::uuid),
('9de4c332-8eca-4cc7-995a-a7a8dce3caff'::uuid,'0eb29c3e-3afb-4660-ba5b-d5a57ebeeb53'::uuid),
('ceeb852f-97a7-4165-ba92-4eee46a3e6e5'::uuid,'509f422c-3757-41a3-bd2b-ef6896e01603'::uuid),
('f7f6616d-23b2-4fe9-a144-778df73fa290'::uuid,'461a4a99-2b78-4bbd-81f3-a36edc5bdfe5'::uuid),
('9d1c86c5-1a3c-49cf-a55a-eac2d564a22d'::uuid,'34e785de-4832-4dd9-998e-0b938da3c6b0'::uuid),
('e630e2d4-2e10-467e-a39d-4da012e0fdbe'::uuid,'2e3dc552-33db-4fb6-a8c2-b394d71d919f'::uuid),
('bc699fe6-66da-432f-9ab1-1ac13ad85d37'::uuid,'b7088845-20b3-46e4-b08a-526078554380'::uuid),
('6a39e205-2d19-4e15-8dc7-811de4bee1a1'::uuid,'a91b94cf-5b98-4bf5-9cc4-e58aa595c38a'::uuid),
('bbd8a082-1699-4f03-9f51-65403279fd1c'::uuid,'bab409d2-118d-4d6b-89d3-4f175a8636e0'::uuid),
('759d4cb4-0d01-4ff3-a024-fb9afa78e338'::uuid,'060bf7ea-1a04-4881-9015-84014b1d76d7'::uuid),
('8d7b9d1e-723a-4b33-8913-34189335a47d'::uuid,'1f0386c3-159f-4d80-8e93-6d3e3013c201'::uuid),
('6a8554f0-6a2e-404e-aa04-bf16f1492833'::uuid,'780cb21e-b232-4060-bcc7-725e3dbb4a1f'::uuid),
('1f51bf2f-1906-441f-9e72-ed1dc9ce3dad'::uuid,'fbd763b1-5208-4896-8347-3e79a4e51db3'::uuid),
('9562aeeb-8b9d-47d8-bcb0-cda3591eab16'::uuid,'268b900e-9a45-4c0c-befb-1e070755beb6'::uuid),
('895a6541-b430-4f8c-a0a9-83cc052411ee'::uuid,'86e174bd-ee01-4735-8083-744208a952aa'::uuid),
('b1c6f568-80cd-45c7-819a-cb9f6e8474b7'::uuid,'22cd9b0e-665f-430d-bf12-b58d799e7d1a'::uuid),
('d522ff50-9bf7-4098-9d2c-ea90403d2e1f'::uuid,'d7680438-1a3d-4aeb-99e7-04f396f17bbf'::uuid),
('7b240686-64b9-4696-aaa4-da51b12d72ba'::uuid,'9315f142-79cd-44e5-85b3-e0674a805e00'::uuid),
('f46d30bc-5cc4-4db8-854b-7b5b31502add'::uuid,'8067a7af-10ab-4d52-84fd-66158ab7c82c'::uuid),
('6e8283d4-e2be-4156-9f9a-cb7e5b1db45c'::uuid,'c66d81cc-95b7-47ac-8bfc-3f64ad35391a'::uuid),
('b43f384f-0a25-4f87-81ad-c9c377307a00'::uuid,'c62281d1-07fa-4246-9909-1124b17e4d95'::uuid),
('0a57e6fc-67eb-42f6-9df4-cd87e74481c9'::uuid,'d818e986-6626-4a6c-9b7c-e9ad86520c7c'::uuid),
('8552a7cf-cc11-4c04-8bd2-5c12c7ae8686'::uuid,'b1b3272f-9b76-4dd6-8f40-6d42bc794856'::uuid),
('959ba11a-8ae8-4765-9233-2ab9f56f59e2'::uuid,'3e0f9a44-c379-4981-aad7-a0a1d66d0e30'::uuid),
('92626eee-f76d-4215-aee4-49363b1731d9'::uuid,'14ef0214-4e67-4ec2-850b-ad11f71eafdd'::uuid),
('8d61bc25-74bf-454c-ada7-1edbe2e25adb'::uuid,'b21b7c79-6edd-467d-a911-5305733de086'::uuid),
('990b38fa-661a-4fab-af66-482972ecd751'::uuid,'a5db64e2-1dea-48de-94ad-121119bdbaf3'::uuid),
('d5a4d8ab-1190-4a28-8425-aabdaff88f18'::uuid,'832976b5-a618-4570-af06-7be43b2933bc'::uuid),
('4aaea22b-139a-44d1-8ac4-b2f0681defb3'::uuid,'89aea592-68d2-48c3-b3e8-de1258b56111'::uuid),
('b8760d40-b516-4e1a-b582-eefd9791e301'::uuid,'1122926f-6bd7-4062-a385-407a8696276a'::uuid),
('61afa80a-1723-407e-ab94-49a7d1086e77'::uuid,'9f3ce207-fe57-4488-bcb4-9ca97ffa6424'::uuid),
('0a599ad3-0b97-4390-bb78-11955f21dc1c'::uuid,'b7a2bf25-46e9-46cb-a392-225b920f2c1a'::uuid),
('e9c288a1-678f-487b-bae5-77d925494380'::uuid,'96a4291b-69cf-485b-9366-323c0dcce834'::uuid),
('bcd682aa-5bf0-4101-be47-59709ca400ec'::uuid,'244b6ea3-737a-40f1-90c8-3f84f3311c73'::uuid),
('57c7f2e5-9ab1-48bc-8fc7-da59874f3b44'::uuid,'80fa1e87-9765-4782-9b21-df47a7dbb966'::uuid),
('ec591aed-a56f-45f6-8359-1a64c0a05426'::uuid,'fbb1cbde-532f-4fc1-86b5-aba6fe8c8cb0'::uuid),
('7c578894-0e5c-4271-97e1-0e0accea4198'::uuid,'fcfa5916-f282-487e-9f42-4925c57d2edf'::uuid),
('45da03fd-521e-4ef8-9710-89e09ef9ddc3'::uuid,'ceda9938-bfcf-4030-86d1-ece0497ec3f2'::uuid),
('b0eb1e12-ed2c-410e-9451-5fb16b8797a2'::uuid,'0e5db8d3-512a-4ea4-9c2e-6222e4a92738'::uuid),
('9fb15111-6b65-4a79-bebc-fb99566af5a4'::uuid,'4485e03a-b676-4e3a-a245-b80612ae498e'::uuid),
('e0aedf7e-b131-4a89-95a8-08716b2be23c'::uuid,'d0e7ffc8-c4a4-4ee2-8ccb-5686f83ddca7'::uuid),
('9a26dfd5-8458-4cca-8938-a7aca3fe2a47'::uuid,'29bd34aa-3a85-4db3-8ce6-02aecbdd9cba'::uuid),
('1d2dc4c4-594c-41c8-97d5-adca4eeff45c'::uuid,'ecf1ff91-1f3a-4647-92d5-9f96ca0e3129'::uuid),
('93f26e07-1148-4743-a0da-f3ca699fee87'::uuid,'75fd5b36-d9ee-4039-b1c7-6d8c8618d0db'::uuid),
('e5709df8-9dac-4e88-b784-1816def08b20'::uuid,'b76f6779-b884-40c4-83cd-4e132b9ae750'::uuid),
('e474c5e7-8643-4832-9b46-2484e0ab420b'::uuid,'6f122d16-9715-49b7-a839-f9c2dcffdfac'::uuid),
('2be0946e-733c-4859-b3e0-359daf3f217e'::uuid,'fe566a34-8b47-4564-b2f5-e4237e0a278c'::uuid),
('ca95ecd6-f655-4c01-b223-438cc2486211'::uuid,'cd33dfa1-e07b-41ad-94c8-c11666f2bc9e'::uuid),
('67bf1ead-f3c4-4d67-8bf3-2fde79b6d57e'::uuid,'cb2e6c35-18ab-4dba-94ba-d530137aa25b'::uuid),
('8b957f72-f2e2-421a-90a3-38bfc269c698'::uuid,'71140d80-ef87-4fbe-a4aa-2d7f298c127f'::uuid),
('0690a3c3-c613-40c2-9d3c-1b7a53b63b0c'::uuid,'bb372691-2dc1-4d3f-8550-57064e60bfd6'::uuid),
('52a1777d-555e-4e4e-9081-c9d0576768aa'::uuid,'1428ea8a-78a8-4b43-92f8-50428b91cd2e'::uuid),
('929468e5-65e0-4df0-ac83-178c4231e172'::uuid,'aab1eba9-05cc-4d7d-85bd-83709f3f7036'::uuid),
('0d2cc179-5e62-4595-827a-29d25bb46af2'::uuid,'363adafb-a4cf-4f37-b340-645351fbd3df'::uuid),
('6eddf3cd-c83c-4909-bd2f-f8cc42cc6b37'::uuid,'8e36243d-4005-46e7-81e8-b908ab097474'::uuid),
('00464684-95b3-4818-b4c7-fbdc5113d313'::uuid,'9d9361c6-084b-4e62-b3d1-43be63c344bb'::uuid),
('73511127-15fa-431a-9994-ec2e18b7ddcb'::uuid,'42cb9c28-e04c-41ef-b0a3-148245ba1e62'::uuid),
('f899bcf4-2cd2-4da3-8cd4-f9f4d3208e4d'::uuid,'dfe2c55f-4e8c-462c-8e38-a4249495d265'::uuid),
('841e2d47-db7e-4222-ae1e-0e306cf92e7c'::uuid,'07bdca42-a7b8-4ed1-ae07-2c3373c434b2'::uuid),
('e87f1c73-bc79-4642-90ea-9c7a12377a40'::uuid,'b8a43585-4209-4363-b948-2f82ed492039'::uuid),
('c184c8db-0ec7-432c-8ff2-65020f586e8f'::uuid,'1d2527b4-dbb1-463a-91e9-9b1925522a22'::uuid),
('5a6876b0-ce8f-46a7-967c-c7084d16e888'::uuid,'1883f419-183f-48b5-9244-d767bdb21fcf'::uuid),
('3674da0a-810d-4889-a2a2-53b737a9cbbe'::uuid,'1809f29e-7e4d-4208-9164-314c085fbfb6'::uuid),
('f2c3cb72-17a4-4132-851e-2691687dd3a3'::uuid,'b911fbe4-3bd7-4b23-a004-eaee32a19249'::uuid),
('7deab614-ba22-4274-9872-fa5fe9a446bf'::uuid,'06d6e649-2d3c-4972-a4bb-28e717f57b0a'::uuid),
('e21f5b84-9f32-4e01-83d7-1651ab2c7ac2'::uuid,'6f83c8f8-0806-401d-b22f-59fd6b9575fb'::uuid),
('4998ec63-600a-42d4-9634-355e59193cf1'::uuid,'4a4c8333-e743-4f7d-9816-b63d89e16c99'::uuid),
('426a00fc-3192-46c2-bb4f-033a35f66ba6'::uuid,'55ade801-e9eb-4fae-939f-49714b4c7224'::uuid),
('deb8d8df-25e6-4b35-a1ab-5cea1ed73bb2'::uuid,'45ee4035-cc84-4b22-9f07-2df2febd497d'::uuid),
('530bc875-a4cc-4701-8795-69034631ea02'::uuid,'16c0e929-c232-4fd2-9f5c-f81b4445a98c'::uuid),
('ab304a53-e7b8-469e-8a70-c3b5be253bcd'::uuid,'3d3d635c-e8ef-4203-b19f-fcdb7b0521f3'::uuid),
('57dbdaa2-0062-4670-89be-d3490b1fbb5e'::uuid,'b079eb80-c7dc-4814-bae1-ecf9ebb95917'::uuid),
('a16aaacc-4e80-4739-9ebb-a8587e9fffb6'::uuid,'e625a4b1-b560-4dc3-8340-ed34219bbb53'::uuid),
('7f57a583-92b8-4d71-a9e0-8c11e0e940bb'::uuid,'c1cfb338-a7ea-4a54-b569-ab3954d20eb6'::uuid),
('8c78a75e-2566-40f7-af0b-46b0bc62215d'::uuid,'0dc4f5e2-07d4-4225-bb79-b8ab2b5f11dc'::uuid),
('8681094e-b3ce-4f5d-8a9f-211679cc08c4'::uuid,'756e6b14-8459-40bc-9414-a1b5d59286b5'::uuid),
('2aea395c-0e99-4c9f-b746-472b992b0b35'::uuid,'ad337f6b-6b0c-449a-8144-b51085281c7b'::uuid),
('005a499b-6593-416c-8754-7bc9021ba114'::uuid,'8e29fef8-4117-4477-b123-9612234d6877'::uuid),
('bf45321d-23f6-41bc-bb01-b85d083d3474'::uuid,'0374a8dd-c56a-4820-8161-adc0056d2490'::uuid),
('2bbfacc8-295f-47e7-a59e-5e0540f06c25'::uuid,'4b25ba12-3bad-446e-96fc-98d8090ea710'::uuid),
('8ed1dffa-8e5a-436a-92ab-e05edae88617'::uuid,'d9be6822-e73d-4bd2-b640-74e93a149bf5'::uuid),
('6942367b-8e27-4604-b1d5-3668de0d2351'::uuid,'b5abc554-e16c-4252-82bb-318dc4b541a2'::uuid),
('05f1468b-9267-447c-a163-6bf319c4fd9b'::uuid,'1ac34296-095a-4d96-af6f-3e93c87c0674'::uuid),
('6d81ec13-6526-4308-ae66-0511a4a1c289'::uuid,'87ae3685-13f9-419a-99d1-7e9cc0034eb5'::uuid),
('cbe28530-b98a-4165-b306-d693f0132137'::uuid,'a16ed75b-7539-4e5b-a5d3-26ce5e589ad9'::uuid),
('cba9daca-985a-4b67-80fe-9a3ce99c3739'::uuid,'dab960bd-408e-4611-af9f-5e9436ab7187'::uuid),
('5de0cf18-d093-449b-8419-6c53baef7701'::uuid,'f7e10dd4-c004-4072-8b7f-388e78797a90'::uuid),
('7d3ce76b-5ee6-42bc-900c-3cdac1096ddf'::uuid,'ba1c4097-f597-47d2-9b0e-ec30d11b91f2'::uuid),
('bd9982a8-3d59-4d3b-8b98-90a40ca81107'::uuid,'04a77614-2861-4e72-a3b2-67d6f5345a34'::uuid),
('6555ad22-92ad-4c85-b756-0bf7b36027c5'::uuid,'e4f38f54-c2e4-43aa-8fe6-1b201670b03d'::uuid),
('9071f1b8-0e0e-4da4-8609-637d047ff6bb'::uuid,'e0e46174-07fd-4f35-87bf-1b30961d0dac'::uuid),
('f83f9399-a684-448e-be64-97fcfe9ac56c'::uuid,'d64b6c7f-04df-4451-821a-d8dde7eff82b'::uuid),
('9089d803-9bd7-4958-8d6e-7b4e94e0acd6'::uuid,'bcdf581e-880b-4387-b9e6-f334c87e84a3'::uuid),
('af49af5b-2933-442b-973c-c6f703e43978'::uuid,'6daff9db-5231-4296-b1bd-208385a9f598'::uuid),
('277f9231-d430-448e-91e1-a0387a1a029e'::uuid,'88c85375-c4ab-4686-a162-6051986a1b58'::uuid),
('a2801199-0489-4d48-bbe4-b1676087a7bd'::uuid,'73f433a3-f89c-4cc9-aa88-118a7e939c53'::uuid),
('31b37f65-2b2c-464c-88af-d6320a97c047'::uuid,'7704b7fb-3fe3-4bce-8499-9a16ddf313ce'::uuid),
('b77aaf59-2a7f-4e83-85f0-02aca89ff6fa'::uuid,'bccb8349-75cd-4598-bf39-2815d8b40d43'::uuid),
('c94755be-e629-448f-97d8-fd393dc05a51'::uuid,'4f20f2ff-f52a-463b-8adc-d5c90d42564f'::uuid),
('115b8631-67c6-480b-beac-91d70ea9da11'::uuid,'4a8c109d-7a1f-440d-a957-b827abf4da76'::uuid),
('e445ac0c-4b46-4413-8292-f295801dec2d'::uuid,'ce90eab5-5de1-45cd-856e-9d0d4980d5c2'::uuid),
('2f6bc142-0a35-4bf8-93ab-0b2afe9a7505'::uuid,'763d3e61-ffb7-43fe-b331-214220d52843'::uuid),
('d3cba6e7-64ba-40d6-aa9f-0f52bbd337f1'::uuid,'1cffc53c-f22e-420a-988f-562cad8c3473'::uuid),
('ea95be7b-9e18-49be-8c24-7be17f02aa8b'::uuid,'2798e4a3-9b45-40a7-bdd9-87630b7ed196'::uuid),
('f16c6cc8-4c70-479e-80be-ffc1eba6c170'::uuid,'6260eab9-5343-496b-bbfe-cb3aa55c8765'::uuid),
('2a834a10-cc2d-4548-8434-73f66fc4d578'::uuid,'4ec7ea26-1cd6-4d37-83ec-ad7bb16e9649'::uuid),
('c7ccde17-d65c-44ef-9cb2-0b6b248eadbb'::uuid,'6bed4b92-4f01-4f4f-82dc-7c7ca4f2a315'::uuid),
('2011c563-1251-499f-aed1-43efde638cf3'::uuid,'639c74dd-97b3-4522-9ece-d7bae6ccfc23'::uuid),
('a5dc576b-9347-4439-b977-c4a89c3ada79'::uuid,'21f52ee9-79a2-4475-b3ab-0d25a2dc416a'::uuid),
('b813f5b2-6a23-4ab9-9f29-ca076b357b26'::uuid,'7b4679fc-ea5f-41d6-a82a-70e741861095'::uuid),
('bda97ec0-1a11-4542-bcca-8ac009039328'::uuid,'da6117fa-a0c1-423a-935d-493c7dbd46a8'::uuid),
('75d66a62-2668-455f-a57a-0639bd09c8a5'::uuid,'aacd16b5-eedd-4a0a-93b8-f1c5b7f3bdbb'::uuid),
('8f22d8b7-5e2f-4d5c-9960-51c38a00baff'::uuid,'fc965e01-d910-40fc-afbb-e010e8eba1b8'::uuid),
('898f5971-382e-40f4-85b5-617877cbbfe1'::uuid,'b6ec41a8-d2d2-4c21-af6a-37ffa769746a'::uuid),
('e7e0b2d2-858c-4063-895e-fb896afd3189'::uuid,'e5ebd326-d86c-4055-b482-c2423ba9554a'::uuid),
('d5211697-8ef5-4e5f-8d7d-48ae9d4e47d6'::uuid,'e9009ab0-da7e-486e-8c99-35b83e00ee61'::uuid),
('468bc728-5b0b-4648-996e-cbfd7a81fce5'::uuid,'9e9eeff4-a366-46fb-a096-f2b0d5b979a1'::uuid),
('fd46f095-2981-4fb9-87e3-5578ab30a026'::uuid,'1a307e82-c669-4d36-890a-52d9ee23ff4d'::uuid),
('3fbfd168-cdec-49c2-a4ea-34bf6c72450a'::uuid,'ce60d4c7-ec29-4a48-b659-85b7511697f3'::uuid),
('d812a87c-1daf-44a1-b780-16f00ab90055'::uuid,'7f12791b-e006-4599-b23c-86ad30ec3909'::uuid),
('478a1db7-a3b2-4022-b06b-b826ca98efca'::uuid,'38fd797b-b6a3-445a-811d-54c184cbe906'::uuid),
('ef4560eb-eb2e-4ea7-be26-539afb2e2103'::uuid,'a95ee71f-0b78-45bf-89cc-79d55e18ee6c'::uuid),
('73b09ae7-ab7a-4057-9ba1-3017343961cc'::uuid,'bd422be9-c725-4fff-a00c-f755088d2011'::uuid),
('a3be933f-c42a-4dae-98fa-16f40490320f'::uuid,'f30a8ead-2e96-40b1-830e-a32ce79b926a'::uuid),
('7cbe06d6-7f14-41a5-8092-d36d7e58d4f6'::uuid,'4ba06f2c-c38d-4dda-aee6-c8a689492d73'::uuid),
('b2385778-afad-4120-8e96-8960a8dca8ff'::uuid,'7b79008e-fe92-439e-ab50-fcf67db02dbf'::uuid),
('b0c55531-cc8c-4b06-934a-551889a32146'::uuid,'277f65a2-ffba-4e3e-b2ec-5bf94709bd18'::uuid),
('2256408b-8d22-4980-b322-0e5247030112'::uuid,'d158d7b3-4598-4d1d-9775-e59446c6460e'::uuid),
('e95fa481-4d10-4eb2-be38-4d208ad9fc02'::uuid,'a4d923b1-3855-457f-b76d-ec668d4a7038'::uuid),
('acffbd9f-19e6-4d5a-8d40-666da5eb569a'::uuid,'4b720ae2-4c27-423a-b14b-b9468fcdcb11'::uuid),
('28fb85a0-77ba-481c-9907-a46cc30f7385'::uuid,'5e82c560-405f-42ff-96cc-a1f59360d9d0'::uuid),
('cf2b7e88-08da-480d-8e01-65f9a9aaaae5'::uuid,'c0814cf3-ce05-4736-9bd3-03b8c2e679f8'::uuid),
('e87fb691-24af-4d8a-99cd-cdf6ff6a128f'::uuid,'e862550f-4f80-4c33-bb4a-ff0f4a262cf2'::uuid),
('7b3c39ae-d500-4455-89e0-7458d3e82055'::uuid,'75fd4043-7e7a-4b4b-b8a2-fc27e6747525'::uuid);

create table dup_0058_relink (id uuid primary key, new_external_id text not null);
insert into dup_0058_relink (id, new_external_id) values
-- relink(row_id, new_external_id)
('2feca365-e44c-4b73-bc7b-8383093c1201'::uuid,'ea430a64-49d4-43db-88ef-2f8f27331661'),
('0cab24a3-8fe5-4bd0-88d3-f6ac00ab3954'::uuid,'a24934a4-891e-4c8c-90b2-e8ef66c79f70'),
('8ae82ad2-d378-45f0-bab8-4794b3e3266f'::uuid,'504f7b69-307d-4615-9d4c-dd9ae866b973'),
('6f226e3b-4dc1-426c-b81c-b9fa11e54b99'::uuid,'9c57181a-934e-4c96-b55a-97925d024c44'),
('3ba0e74a-234d-4320-94a5-677416b4a5d9'::uuid,'6d4813b0-8043-4f98-9538-97c8907ca02f'),
('a6c795a6-51c2-42eb-ae98-26dd13d1724f'::uuid,'bad5702b-a9ab-451c-bcab-65703f633d79'),
('507a4af1-d332-4cee-8a96-312b68a8db82'::uuid,'f6ab3d0d-21cc-4e81-b508-7e50aeecc446');

-- Guards: stop if the ledger moved since the review.
do $$
begin
  if (select count(*) from dup_0058_pairs p
        join transactions g on g.id = p.ghost
        join transactions t on t.id = p.twin) <> 190 then
    raise exception '0058: expected 190 ghost/twin pairs still present';
  end if;
  if (select count(*) from dup_0058_relink r join transactions t on t.id = r.id) <> 7 then
    raise exception '0058: expected 7 relink rows still present';
  end if;
  if exists (select 1 from dup_0058_relink r join transactions t on t.id = r.id
             join transactions o on o.account_id = t.account_id and o.external_id = r.new_external_id) then
    raise exception '0058: a new external id is already in use';
  end if;
end $$;

-- Backups / snapshots (all in public: RLS on, like every other table).
create table dup_backup_0058_transactions   as select * from transactions               where id in (select ghost from dup_0058_pairs);
create table dup_backup_0058_reimbursements as select * from transaction_reimbursements where transaction_id in (select ghost from dup_0058_pairs);
create table dup_backup_0058_receipts       as select * from transaction_receipts       where transaction_id in (select ghost from dup_0058_pairs);
create table snapshot_0058_twins            as select * from transactions               where id in (select twin from dup_0058_pairs);
create table snapshot_0058_twin_reimb_ids   as select id from transaction_reimbursements where transaction_id in (select twin from dup_0058_pairs);
create table snapshot_0058_twin_receipt_ids as select id from transaction_receipts       where transaction_id in (select twin from dup_0058_pairs);
create table snapshot_0058_refs as
  select 'nota_fiscais'::text tbl, id, transaction_id as ref from nota_fiscais where transaction_id in (select ghost from dup_0058_pairs)
  union all
  select 'nota_fiscal_payments', id, transaction_id from nota_fiscal_payments where transaction_id in (select ghost from dup_0058_pairs)
  union all
  select 'merchant_rules', id, created_from_transaction_id from merchant_rules where created_from_transaction_id in (select ghost from dup_0058_pairs);
create table snapshot_0058_relink as
  select t.id, t.external_id as old_external_id from transactions t where t.id in (select id from dup_0058_relink);

alter table dup_0058_pairs                  enable row level security;
alter table dup_0058_relink                 enable row level security;
alter table dup_backup_0058_transactions    enable row level security;
alter table dup_backup_0058_reimbursements  enable row level security;
alter table dup_backup_0058_receipts        enable row level security;
alter table snapshot_0058_twins             enable row level security;
alter table snapshot_0058_twin_reimb_ids    enable row level security;
alter table snapshot_0058_twin_receipt_ids  enable row level security;
alter table snapshot_0058_refs              enable row level security;
alter table snapshot_0058_relink            enable row level security;

-- 1. Carry the hand review onto the living copy.
with best as (
  select distinct on (p.twin) p.twin, g.*
  from dup_0058_pairs p join transactions g on g.id = p.ghost
  order by p.twin, (g.status in ('user_edited','user_confirmed')) desc, g.updated_at desc
)
update transactions t
set category_id   = b.category_id,
    shared_amount = b.shared_amount,
    is_transfer   = b.is_transfer,
    status        = b.status,
    confidence    = b.confidence,
    ai_reasoning  = b.ai_reasoning,
    notes_private = coalesce(t.notes_private, b.notes_private)
from best b
where t.id = b.twin and b.status in ('user_edited','user_confirmed');

-- 2. Receipt-search stamps (so the nightly search does not redo them).
with best as (
  select distinct on (p.twin) p.twin, g.*
  from dup_0058_pairs p join transactions g on g.id = p.ghost
  where g.gmail_searched_at is not null
  order by p.twin, g.gmail_match_count desc nulls last, g.gmail_searched_at desc
)
update transactions t
set gmail_searched_at     = b.gmail_searched_at,
    gmail_match_count     = b.gmail_match_count,
    gmail_search_error    = b.gmail_search_error,
    gmail_search_attempts = b.gmail_search_attempts
from best b
where t.id = b.twin and t.gmail_searched_at is null;

-- 3. Tags and receipts: copy, never overwrite.
insert into transaction_reimbursements (transaction_id, tag_id, status, reimbursement_amount, submitted_at, reimbursed_at, notes)
select p.twin, r.tag_id, r.status, r.reimbursement_amount, r.submitted_at, r.reimbursed_at, r.notes
from dup_backup_0058_reimbursements r join dup_0058_pairs p on p.ghost = r.transaction_id
on conflict (transaction_id, tag_id) do nothing;

insert into transaction_receipts (transaction_id, gmail_message_id, gmail_thread_id, subject, from_email, from_name, sent_at,
  has_attachment, attachment_count, match_score, match_reason, confirmed, created_at, confidence, match_source,
  match_snippet, amount_brl, source_email)
select p.twin, r.gmail_message_id, r.gmail_thread_id, r.subject, r.from_email, r.from_name, r.sent_at,
  r.has_attachment, r.attachment_count, r.match_score, r.match_reason, r.confirmed, r.created_at, r.confidence, r.match_source,
  r.match_snippet, r.amount_brl, r.source_email
from dup_backup_0058_receipts r join dup_0058_pairs p on p.ghost = r.transaction_id
on conflict (transaction_id, gmail_message_id) do nothing;

-- 4. Pointers from other tables follow the living copy.
update nota_fiscais x set transaction_id = p.twin from dup_0058_pairs p where x.transaction_id = p.ghost;
update nota_fiscal_payments x set transaction_id = p.twin from dup_0058_pairs p where x.transaction_id = p.ghost;
update merchant_rules x set created_from_transaction_id = p.twin from dup_0058_pairs p where x.created_from_transaction_id = p.ghost;

-- 5. Remove the old copies (backed up above).
delete from transactions where id in (select ghost from dup_0058_pairs);

-- 6. Same purchase, new Pluggy id: point the row at the new id.
update transactions t set external_id = r.new_external_id from dup_0058_relink r where t.id = r.id;

commit;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run by hand, in one transaction, if this ever proves wrong):
--
-- begin;
-- update transactions t set external_id = s.old_external_id from snapshot_0058_relink s where t.id = s.id;
-- insert into transactions select * from dup_backup_0058_transactions;
-- insert into transaction_reimbursements select * from dup_backup_0058_reimbursements on conflict do nothing;
-- insert into transaction_receipts select * from dup_backup_0058_receipts on conflict do nothing;
-- update nota_fiscais x set transaction_id = s.ref from snapshot_0058_refs s where s.tbl = 'nota_fiscais' and x.id = s.id;
-- update nota_fiscal_payments x set transaction_id = s.ref from snapshot_0058_refs s where s.tbl = 'nota_fiscal_payments' and x.id = s.id;
-- update merchant_rules x set created_from_transaction_id = s.ref from snapshot_0058_refs s where s.tbl = 'merchant_rules' and x.id = s.id;
-- delete from transaction_reimbursements where transaction_id in (select twin from dup_0058_pairs)
--   and id not in (select id from snapshot_0058_twin_reimb_ids);
-- delete from transaction_receipts where transaction_id in (select twin from dup_0058_pairs)
--   and id not in (select id from snapshot_0058_twin_receipt_ids);
-- update transactions t set category_id = s.category_id, shared_amount = s.shared_amount, is_transfer = s.is_transfer,
--   status = s.status, confidence = s.confidence, ai_reasoning = s.ai_reasoning, notes_private = s.notes_private,
--   gmail_searched_at = s.gmail_searched_at, gmail_match_count = s.gmail_match_count,
--   gmail_search_error = s.gmail_search_error, gmail_search_attempts = s.gmail_search_attempts
-- from snapshot_0058_twins s where t.id = s.id;
-- commit;
-- ---------------------------------------------------------------------------
