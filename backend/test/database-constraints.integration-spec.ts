import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client.js';

// Exercises the Phase 0A-R1 database-level protections (CHECK constraints, append-only triggers,
// functional unique indexes) directly against a real PostgreSQL database — the things Prisma's
// schema language cannot express and so cannot be caught by `prisma validate` or the unit tests.
// Requires DATABASE_URL to point at a database with the current migration applied.
//
// Some tests below insert via `$executeRawUnsafe` rather than the typed Prisma Client: a handful
// of "required field missing" cases (e.g. a NULL SafetyEvent.decisionSnapshot) are rejected by
// Prisma's own generated TypeScript types before a request is ever sent, which proves nothing
// about the database itself. Raw SQL bypasses that client-side type safety so these tests prove
// the database's own NOT NULL / CHECK enforcement, not just the ORM layer's.
describe('Phase 0A-R1 database constraints', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'] }) });

  let userId: string;
  let user2Id: string;
  let customerId: string;
  let projectId: string;
  let jobcardId: string;
  let equipmentId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `it-${Date.now()}@example.invalid`, passwordHash: 'x', fullName: 'Integration User' },
    });
    userId = user.id;
    const user2 = await prisma.user.create({
      data: { email: `it2-${Date.now()}@example.invalid`, passwordHash: 'x', fullName: 'Integration User Two' },
    });
    user2Id = user2.id;
    const customer = await prisma.customer.create({ data: { no: `IT-C-${Date.now()}`, name: 'IT Co', status: 'ACTIVE' } });
    customerId = customer.id;
    const project = await prisma.project.create({ data: { no: `IT-P-${Date.now()}`, customerId, name: 'IT Project' } });
    projectId = project.id;
    const jobcard = await prisma.jobcard.create({ data: { no: `IT-J-${Date.now()}`, projectId } });
    jobcardId = jobcard.id;
    const equipment = await prisma.equipment.create({ data: { equipmentId: `IT-EQ-${Date.now()}`, name: 'IT Welder' } });
    equipmentId = equipment.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('Blocker 1: UUID identity', () => {
    it('InventoryItem has a UUID id, with code as a separate business key', async () => {
      const item = await prisma.inventoryItem.create({ data: { code: `IT-ITEM-${Date.now()}`, description: 'x' } });
      expect(item.id).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('BarcodeLink has a UUID id, and references InventoryItem by real UUID FK', async () => {
      const item = await prisma.inventoryItem.create({ data: { code: `IT-ITEM2-${Date.now()}`, description: 'x' } });
      const link = await prisma.barcodeLink.create({ data: { barcode: `IT-BC-${Date.now()}`, inventoryItemId: item.id } });
      expect(link.id).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('rejects a StockMovement pointing at a nonexistent inventoryItemId', async () => {
      await expect(
        prisma.stockMovement.create({ data: { inventoryItemId: crypto.randomUUID(), action: 'RECEIVED', qty: '1' } }),
      ).rejects.toThrow();
    });
  });

  describe('Blocker 2 & 7: actor foreign keys and requisition status', () => {
    it('PurchaseRequisition defaults to DRAFT and accepts real actor FKs', async () => {
      const req = await prisma.purchaseRequisition.create({
        data: { no: `IT-REQ-${Date.now()}`, projectId, requestedById: userId, approvedById: user2Id },
      });
      expect(req.status).toBe('DRAFT');
    });

    it('rejects a bogus requestedById', async () => {
      await expect(
        prisma.purchaseRequisition.create({ data: { no: `IT-REQ2-${Date.now()}`, requestedById: crypto.randomUUID() } }),
      ).rejects.toThrow();
    });
  });

  describe('Blocker 6: NCR/CAPA single source of truth', () => {
    it('one CAPA can be linked from multiple NCRs via the single authoritative capaId column', async () => {
      const capa = await prisma.qualityCapa.create({ data: { no: `IT-CAPA-${Date.now()}` } });
      await prisma.qualityNcr.create({
        data: { no: `IT-NCR-${Date.now()}-1`, title: 't1', category: 'PROCESS', severity: 'MINOR', capaId: capa.id },
      });
      await prisma.qualityNcr.create({
        data: { no: `IT-NCR-${Date.now()}-2`, title: 't2', category: 'PROCESS', severity: 'MINOR', capaId: capa.id },
      });
      const found = await prisma.qualityCapa.findUniqueOrThrow({
        where: { id: capa.id },
        include: { ncrsLinkedToThisCapa: true },
      });
      expect(found.ncrsLinkedToThisCapa).toHaveLength(2);
    });
  });

  describe('Blocker 3 / review-correction: SafetyEvent completeness', () => {
    it('accepts a USER-actor gate decision with exactly the matching target, reasons and snapshot', async () => {
      const evt = await prisma.safetyEvent.create({
        data: {
          kind: 'EQUIPMENT_BLOCK',
          equipmentId,
          reasons: ['overdue inspection'],
          gateVersion: 'v1',
          decisionSnapshot: { checkedAt: new Date().toISOString() },
          actorType: 'USER',
          userId,
        },
      });
      expect(evt.id).toBeDefined();
    });

    it('accepts an empty reasons array for a successful gate (not NULL)', async () => {
      const evt = await prisma.safetyEvent.create({
        data: { kind: 'EQUIPMENT_PASS', equipmentId, gateVersion: 'v1', decisionSnapshot: { ok: true }, actorType: 'SYSTEM' },
      });
      expect(evt.reasons).toEqual([]);
    });

    it('accepts a SYSTEM actor with no userId', async () => {
      const evt = await prisma.safetyEvent.create({
        data: { kind: 'EQUIPMENT_PASS', equipmentId, gateVersion: 'v1', decisionSnapshot: {}, actorType: 'SYSTEM' },
      });
      expect(evt.id).toBeDefined();
    });

    it('rejects a USER actor with no userId (no anonymous safety actions)', async () => {
      await expect(
        prisma.safetyEvent.create({
          data: { kind: 'EQUIPMENT_PASS', equipmentId, gateVersion: 'v1', decisionSnapshot: {}, actorType: 'USER' },
        }),
      ).rejects.toThrow();
    });

    it('rejects a SYSTEM actor with a userId set', async () => {
      await expect(
        prisma.safetyEvent.create({
          data: { kind: 'EQUIPMENT_PASS', equipmentId, gateVersion: 'v1', decisionSnapshot: {}, actorType: 'SYSTEM', userId },
        }),
      ).rejects.toThrow();
    });

    it('rejects a gate-decision kind with no target', async () => {
      await expect(
        prisma.safetyEvent.create({ data: { kind: 'EQUIPMENT_BLOCK', gateVersion: 'v1', decisionSnapshot: {}, actorType: 'SYSTEM' } }),
      ).rejects.toThrow();
    });

    it('rejects a gate-decision kind with the wrong target type', async () => {
      await expect(
        prisma.safetyEvent.create({
          data: {
            kind: 'EQUIPMENT_BLOCK',
            gateVersion: 'v1',
            decisionSnapshot: {},
            actorType: 'SYSTEM',
            qualityHoldId: crypto.randomUUID(),
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects a NULL reasons value at the database level (bypassing Prisma types via raw SQL)', async () => {
      const id = crypto.randomUUID();
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "SafetyEvent" (id, kind, "equipmentId", reasons, "gateVersion", "decisionSnapshot", "actorType")
           VALUES ($1, 'EQUIPMENT_BLOCK', $2, NULL, 'v1', '{}'::jsonb, 'SYSTEM')`,
          id,
          equipmentId,
        ),
      ).rejects.toThrow();
    });

    it('rejects a NULL decisionSnapshot value at the database level (bypassing Prisma types via raw SQL)', async () => {
      const id = crypto.randomUUID();
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "SafetyEvent" (id, kind, "equipmentId", reasons, "gateVersion", "decisionSnapshot", "actorType")
           VALUES ($1, 'EQUIPMENT_BLOCK', $2, '[]'::jsonb, 'v1', NULL, 'SYSTEM')`,
          id,
          equipmentId,
        ),
      ).rejects.toThrow();
    });

    it('rejects a blank gateVersion', async () => {
      await expect(
        prisma.safetyEvent.create({
          data: { kind: 'EQUIPMENT_BLOCK', equipmentId, gateVersion: '   ', decisionSnapshot: {}, actorType: 'SYSTEM' },
        }),
      ).rejects.toThrow();
    });

    describe('review-correction: reasons/decisionSnapshot must be the right JSON shape, not just non-SQL-NULL', () => {
      it('rejects a JSON `null` (not SQL NULL) reasons value via raw SQL', async () => {
        const id = crypto.randomUUID();
        await expect(
          prisma.$executeRawUnsafe(
            `INSERT INTO "SafetyEvent" (id, kind, "equipmentId", reasons, "gateVersion", "decisionSnapshot", "actorType")
             VALUES ($1, 'EQUIPMENT_BLOCK', $2, 'null'::jsonb, 'v1', '{}'::jsonb, 'SYSTEM')`,
            id,
            equipmentId,
          ),
        ).rejects.toThrow();
      });

      it('rejects a JSON `null` (not SQL NULL) decisionSnapshot value via raw SQL', async () => {
        const id = crypto.randomUUID();
        await expect(
          prisma.$executeRawUnsafe(
            `INSERT INTO "SafetyEvent" (id, kind, "equipmentId", reasons, "gateVersion", "decisionSnapshot", "actorType")
             VALUES ($1, 'EQUIPMENT_BLOCK', $2, '[]'::jsonb, 'v1', 'null'::jsonb, 'SYSTEM')`,
            id,
            equipmentId,
          ),
        ).rejects.toThrow();
      });

      it('rejects reasons stored as a JSON object instead of an array via raw SQL', async () => {
        const id = crypto.randomUUID();
        await expect(
          prisma.$executeRawUnsafe(
            `INSERT INTO "SafetyEvent" (id, kind, "equipmentId", reasons, "gateVersion", "decisionSnapshot", "actorType")
             VALUES ($1, 'EQUIPMENT_BLOCK', $2, '{}'::jsonb, 'v1', '{}'::jsonb, 'SYSTEM')`,
            id,
            equipmentId,
          ),
        ).rejects.toThrow();
      });

      it('rejects decisionSnapshot stored as a JSON array instead of an object via raw SQL', async () => {
        const id = crypto.randomUUID();
        await expect(
          prisma.$executeRawUnsafe(
            `INSERT INTO "SafetyEvent" (id, kind, "equipmentId", reasons, "gateVersion", "decisionSnapshot", "actorType")
             VALUES ($1, 'EQUIPMENT_BLOCK', $2, '[]'::jsonb, 'v1', '[]'::jsonb, 'SYSTEM')`,
            id,
            equipmentId,
          ),
        ).rejects.toThrow();
      });

      it('accepts an empty reasons array and an empty decisionSnapshot object (the valid "nothing to report" shape)', async () => {
        const evt = await prisma.safetyEvent.create({
          data: { kind: 'EQUIPMENT_PASS', equipmentId, gateVersion: 'v1', reasons: [], decisionSnapshot: {}, actorType: 'SYSTEM' },
        });
        expect(evt.reasons).toEqual([]);
        expect(evt.decisionSnapshot).toEqual({});
      });
    });

    it('remains append-only: rejects UPDATE and DELETE', async () => {
      const evt = await prisma.safetyEvent.create({
        data: { kind: 'EQUIPMENT_BLOCK', equipmentId, gateVersion: 'v1', decisionSnapshot: {}, actorType: 'SYSTEM' },
      });
      await expect(prisma.safetyEvent.update({ where: { id: evt.id }, data: { gateVersion: 'v2' } })).rejects.toThrow();
      await expect(prisma.safetyEvent.delete({ where: { id: evt.id } })).rejects.toThrow();
    });

    describe('DOCUMENT_SUPERSEDED — typed document-version foreign keys', () => {
      it('accepts a valid pair of distinct, existing documents', async () => {
        const doc1 = await prisma.document.create({ data: { name: 'v1.pdf' } });
        const doc2 = await prisma.document.create({ data: { name: 'v2.pdf', previousVersionId: doc1.id } });
        const evt = await prisma.safetyEvent.create({
          data: {
            kind: 'DOCUMENT_SUPERSEDED',
            previousDocumentId: doc1.id,
            newDocumentId: doc2.id,
            gateVersion: 'v1',
            decisionSnapshot: {},
            actorType: 'SYSTEM',
          },
        });
        expect(evt.id).toBeDefined();
      });

      it('rejects DOCUMENT_SUPERSEDED with both document ids missing', async () => {
        await expect(
          prisma.safetyEvent.create({
            data: { kind: 'DOCUMENT_SUPERSEDED', gateVersion: 'v1', decisionSnapshot: {}, actorType: 'SYSTEM' },
          }),
        ).rejects.toThrow();
      });

      it('rejects DOCUMENT_SUPERSEDED with only previousDocumentId set', async () => {
        const doc = await prisma.document.create({ data: { name: 'only-prev.pdf' } });
        await expect(
          prisma.safetyEvent.create({
            data: {
              kind: 'DOCUMENT_SUPERSEDED',
              previousDocumentId: doc.id,
              gateVersion: 'v1',
              decisionSnapshot: {},
              actorType: 'SYSTEM',
            },
          }),
        ).rejects.toThrow();
      });

      it('rejects DOCUMENT_SUPERSEDED with only newDocumentId set', async () => {
        const doc = await prisma.document.create({ data: { name: 'only-new.pdf' } });
        await expect(
          prisma.safetyEvent.create({
            data: {
              kind: 'DOCUMENT_SUPERSEDED',
              newDocumentId: doc.id,
              gateVersion: 'v1',
              decisionSnapshot: {},
              actorType: 'SYSTEM',
            },
          }),
        ).rejects.toThrow();
      });

      it('rejects DOCUMENT_SUPERSEDED where previousDocumentId equals newDocumentId', async () => {
        const doc = await prisma.document.create({ data: { name: 'same.pdf' } });
        await expect(
          prisma.safetyEvent.create({
            data: {
              kind: 'DOCUMENT_SUPERSEDED',
              previousDocumentId: doc.id,
              newDocumentId: doc.id,
              gateVersion: 'v1',
              decisionSnapshot: {},
              actorType: 'SYSTEM',
            },
          }),
        ).rejects.toThrow();
      });

      it('rejects DOCUMENT_SUPERSEDED referencing a nonexistent document id', async () => {
        const doc = await prisma.document.create({ data: { name: 'real.pdf' } });
        await expect(
          prisma.safetyEvent.create({
            data: {
              kind: 'DOCUMENT_SUPERSEDED',
              previousDocumentId: doc.id,
              newDocumentId: crypto.randomUUID(),
              gateVersion: 'v1',
              decisionSnapshot: {},
              actorType: 'SYSTEM',
            },
          }),
        ).rejects.toThrow();
      });

      it('rejects DOCUMENT_SUPERSEDED that also sets equipmentId', async () => {
        const doc1 = await prisma.document.create({ data: { name: 'a.pdf' } });
        const doc2 = await prisma.document.create({ data: { name: 'b.pdf' } });
        await expect(
          prisma.safetyEvent.create({
            data: {
              kind: 'DOCUMENT_SUPERSEDED',
              previousDocumentId: doc1.id,
              newDocumentId: doc2.id,
              equipmentId,
              gateVersion: 'v1',
              decisionSnapshot: {},
              actorType: 'SYSTEM',
            },
          }),
        ).rejects.toThrow();
      });

      describe('review-correction: the event must match the real Document version chain', () => {
        it('rejects DOCUMENT_SUPERSEDED when newDocument.previousVersionId does not point at previousDocumentId (unrelated documents)', async () => {
          const unrelatedOld = await prisma.document.create({ data: { name: 'unrelated-old.pdf' } });
          // newDoc has no previousVersionId at all — it does not supersede anything.
          const newDoc = await prisma.document.create({ data: { name: 'standalone-new.pdf' } });
          await expect(
            prisma.safetyEvent.create({
              data: {
                kind: 'DOCUMENT_SUPERSEDED',
                previousDocumentId: unrelatedOld.id,
                newDocumentId: newDoc.id,
                gateVersion: 'v1',
                decisionSnapshot: {},
                actorType: 'SYSTEM',
              },
            }),
          ).rejects.toThrow();
        });

        it('rejects DOCUMENT_SUPERSEDED when newDocument.previousVersionId points at a THIRD document, not the stated previousDocumentId', async () => {
          const realPrevious = await prisma.document.create({ data: { name: 'real-previous.pdf' } });
          const decoyPrevious = await prisma.document.create({ data: { name: 'decoy-previous.pdf' } });
          const newDoc = await prisma.document.create({
            data: { name: 'actually-supersedes-real.pdf', previousVersionId: realPrevious.id },
          });
          // Claim the decoy was superseded, when the Document chain actually says realPrevious was.
          await expect(
            prisma.safetyEvent.create({
              data: {
                kind: 'DOCUMENT_SUPERSEDED',
                previousDocumentId: decoyPrevious.id,
                newDocumentId: newDoc.id,
                gateVersion: 'v1',
                decisionSnapshot: {},
                actorType: 'SYSTEM',
              },
            }),
          ).rejects.toThrow();
        });

        it('accepts DOCUMENT_SUPERSEDED when newDocument.previousVersionId genuinely equals previousDocumentId', async () => {
          const previous = await prisma.document.create({ data: { name: 'genuine-previous.pdf' } });
          const newDoc = await prisma.document.create({
            data: { name: 'genuine-new.pdf', previousVersionId: previous.id },
          });
          const evt = await prisma.safetyEvent.create({
            data: {
              kind: 'DOCUMENT_SUPERSEDED',
              previousDocumentId: previous.id,
              newDocumentId: newDoc.id,
              gateVersion: 'v1',
              decisionSnapshot: {},
              actorType: 'SYSTEM',
            },
          });
          expect(evt.id).toBeDefined();
        });
      });
    });
  });

  describe('Blocker 4 / review-correction: QualityRelease decision integrity', () => {
    it('accepts a complete RELEASED decision with USER attribution', async () => {
      const release = await prisma.qualityRelease.create({
        data: {
          no: `IT-REL-${Date.now()}-a`,
          projectId,
          result: 'RELEASED',
          decisionActorType: 'USER',
          decidedById: userId,
          decidedAt: new Date(),
          gateVersion: 'v1',
          gateResultSnapshot: { checks: ['ncr', 'hold'] },
        },
      });
      expect(release.blockingReasons).toEqual([]);
    });

    it('accepts a complete RELEASED_WITH_CONDITIONS decision with SYSTEM attribution', async () => {
      const release = await prisma.qualityRelease.create({
        data: {
          no: `IT-REL-${Date.now()}-b`,
          projectId,
          result: 'RELEASED_WITH_CONDITIONS',
          decisionActorType: 'SYSTEM',
          decidedAt: new Date(),
          gateVersion: 'v1',
          gateResultSnapshot: {},
          blockingReasons: ['minor paperwork pending'],
        },
      });
      expect(release.id).toBeDefined();
    });

    it('rejects USER decisionActorType with no decidedById', async () => {
      await expect(
        prisma.qualityRelease.create({
          data: {
            no: `IT-REL-${Date.now()}-c`,
            projectId,
            result: 'NOT_RELEASED',
            decisionActorType: 'USER',
            decidedAt: new Date(),
            gateVersion: 'v1',
            gateResultSnapshot: {},
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects SYSTEM decisionActorType with a decidedById set', async () => {
      await expect(
        prisma.qualityRelease.create({
          data: {
            no: `IT-REL-${Date.now()}-d`,
            projectId,
            result: 'NOT_RELEASED',
            decisionActorType: 'SYSTEM',
            decidedById: userId,
            decidedAt: new Date(),
            gateVersion: 'v1',
            gateResultSnapshot: {},
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects a blank gateVersion', async () => {
      await expect(
        prisma.qualityRelease.create({
          data: {
            no: `IT-REL-${Date.now()}-e`,
            projectId,
            result: 'NOT_RELEASED',
            decisionActorType: 'SYSTEM',
            decidedAt: new Date(),
            gateVersion: '   ',
            gateResultSnapshot: {},
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects a NULL decidedAt at the database level (bypassing Prisma types via raw SQL)', async () => {
      const id = crypto.randomUUID();
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "QualityRelease" (id, no, "projectId", result, "decisionActorType", "decidedAt", "gateVersion", "gateResultSnapshot", "blockingReasons")
           VALUES ($1, $2, $3, 'NOT_RELEASED', 'SYSTEM', NULL, 'v1', '{}'::jsonb, '[]'::jsonb)`,
          id,
          `IT-REL-RAW-${Date.now()}`,
          projectId,
        ),
      ).rejects.toThrow();
    });

    it('rejects a NULL gateResultSnapshot at the database level (bypassing Prisma types via raw SQL)', async () => {
      const id = crypto.randomUUID();
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "QualityRelease" (id, no, "projectId", result, "decisionActorType", "decidedAt", "gateVersion", "gateResultSnapshot", "blockingReasons")
           VALUES ($1, $2, $3, 'NOT_RELEASED', 'SYSTEM', now(), 'v1', NULL, '[]'::jsonb)`,
          id,
          `IT-REL-RAW2-${Date.now()}`,
          projectId,
        ),
      ).rejects.toThrow();
    });

    it('rejects UPDATE and DELETE on an existing release', async () => {
      const release = await prisma.qualityRelease.create({
        data: {
          no: `IT-REL-${Date.now()}-f`,
          projectId,
          result: 'NOT_RELEASED',
          decisionActorType: 'SYSTEM',
          decidedAt: new Date(),
          gateVersion: 'v1',
          gateResultSnapshot: {},
        },
      });
      await expect(prisma.qualityRelease.update({ where: { id: release.id }, data: { result: 'RELEASED' } })).rejects.toThrow();
      await expect(prisma.qualityRelease.delete({ where: { id: release.id } })).rejects.toThrow();
    });

    it('rejects a release whose previousVersionId is its own id', async () => {
      const id = crypto.randomUUID();
      await expect(
        prisma.qualityRelease.create({
          data: {
            id,
            no: `IT-REL-BAD-${Date.now()}`,
            projectId,
            result: 'RELEASED',
            decisionActorType: 'SYSTEM',
            decidedAt: new Date(),
            gateVersion: 'v1',
            gateResultSnapshot: {},
            previousVersionId: id,
          },
        }),
      ).rejects.toThrow();
    });

    it('allows a new release to legitimately supersede a different one — no supersededAt on either row', async () => {
      const original = await prisma.qualityRelease.create({
        data: {
          no: `IT-REL-${Date.now()}-orig`,
          projectId,
          result: 'NOT_RELEASED',
          decisionActorType: 'SYSTEM',
          decidedAt: new Date(),
          gateVersion: 'v1',
          gateResultSnapshot: {},
        },
      });
      const replacement = await prisma.qualityRelease.create({
        data: {
          no: `IT-REL-${Date.now()}-new`,
          projectId,
          result: 'RELEASED',
          decisionActorType: 'USER',
          decidedById: userId,
          decidedAt: new Date(),
          gateVersion: 'v2',
          gateResultSnapshot: {},
          previousVersionId: original.id,
        },
      });
      expect(replacement.previousVersionId).toBe(original.id);
      expect('supersededAt' in replacement).toBe(false);
    });

    describe('review-correction: supersession context — previousVersionId must stay in the same project/jobcard', () => {
      it('rejects supersession across two different projects', async () => {
        const otherCustomer = await prisma.customer.create({ data: { no: `IT-C2-${Date.now()}`, name: 'Other Co', status: 'ACTIVE' } });
        const otherProject = await prisma.project.create({ data: { no: `IT-P2-${Date.now()}`, customerId: otherCustomer.id, name: 'Other Project' } });
        const original = await prisma.qualityRelease.create({
          data: {
            no: `IT-REL-XPROJ-${Date.now()}-orig`,
            projectId,
            result: 'NOT_RELEASED',
            decisionActorType: 'SYSTEM',
            decidedAt: new Date(),
            gateVersion: 'v1',
            gateResultSnapshot: {},
          },
        });
        await expect(
          prisma.qualityRelease.create({
            data: {
              no: `IT-REL-XPROJ-${Date.now()}-new`,
              projectId: otherProject.id,
              result: 'RELEASED',
              decisionActorType: 'SYSTEM',
              decidedAt: new Date(),
              gateVersion: 'v2',
              gateResultSnapshot: {},
              previousVersionId: original.id,
            },
          }),
        ).rejects.toThrow();
      });

      it('rejects supersession across two different jobcards within the same project', async () => {
        const otherJobcard = await prisma.jobcard.create({ data: { no: `IT-J2-${Date.now()}`, projectId } });
        const original = await prisma.qualityRelease.create({
          data: {
            no: `IT-REL-XJOB-${Date.now()}-orig`,
            projectId,
            jobcardId,
            result: 'NOT_RELEASED',
            decisionActorType: 'SYSTEM',
            decidedAt: new Date(),
            gateVersion: 'v1',
            gateResultSnapshot: {},
          },
        });
        await expect(
          prisma.qualityRelease.create({
            data: {
              no: `IT-REL-XJOB-${Date.now()}-new`,
              projectId,
              jobcardId: otherJobcard.id,
              result: 'RELEASED',
              decisionActorType: 'SYSTEM',
              decidedAt: new Date(),
              gateVersion: 'v2',
              gateResultSnapshot: {},
              previousVersionId: original.id,
            },
          }),
        ).rejects.toThrow();
      });

      it('rejects supersession where the previous release has a jobcard but the new one has none', async () => {
        const original = await prisma.qualityRelease.create({
          data: {
            no: `IT-REL-NULLJOB-${Date.now()}-orig`,
            projectId,
            jobcardId,
            result: 'NOT_RELEASED',
            decisionActorType: 'SYSTEM',
            decidedAt: new Date(),
            gateVersion: 'v1',
            gateResultSnapshot: {},
          },
        });
        await expect(
          prisma.qualityRelease.create({
            data: {
              no: `IT-REL-NULLJOB-${Date.now()}-new`,
              projectId,
              // jobcardId omitted — mismatches the original's jobcardId
              result: 'RELEASED',
              decisionActorType: 'SYSTEM',
              decidedAt: new Date(),
              gateVersion: 'v2',
              gateResultSnapshot: {},
              previousVersionId: original.id,
            },
          }),
        ).rejects.toThrow();
      });

      it('accepts supersession within the same project and the same jobcard', async () => {
        const original = await prisma.qualityRelease.create({
          data: {
            no: `IT-REL-OK-${Date.now()}-orig`,
            projectId,
            jobcardId,
            result: 'NOT_RELEASED',
            decisionActorType: 'SYSTEM',
            decidedAt: new Date(),
            gateVersion: 'v1',
            gateResultSnapshot: {},
          },
        });
        const replacement = await prisma.qualityRelease.create({
          data: {
            no: `IT-REL-OK-${Date.now()}-new`,
            projectId,
            jobcardId,
            result: 'RELEASED',
            decisionActorType: 'SYSTEM',
            decidedAt: new Date(),
            gateVersion: 'v2',
            gateResultSnapshot: {},
            previousVersionId: original.id,
          },
        });
        expect(replacement.previousVersionId).toBe(original.id);
      });

      it('accepts supersession within the same project when both releases have no jobcard', async () => {
        const original = await prisma.qualityRelease.create({
          data: {
            no: `IT-REL-OKNULL-${Date.now()}-orig`,
            projectId,
            result: 'NOT_RELEASED',
            decisionActorType: 'SYSTEM',
            decidedAt: new Date(),
            gateVersion: 'v1',
            gateResultSnapshot: {},
          },
        });
        const replacement = await prisma.qualityRelease.create({
          data: {
            no: `IT-REL-OKNULL-${Date.now()}-new`,
            projectId,
            result: 'RELEASED',
            decisionActorType: 'SYSTEM',
            decidedAt: new Date(),
            gateVersion: 'v2',
            gateResultSnapshot: {},
            previousVersionId: original.id,
          },
        });
        expect(replacement.previousVersionId).toBe(original.id);
      });
    });

    describe('review-correction: gateResultSnapshot/blockingReasons must be the right JSON shape, not just non-SQL-NULL', () => {
      it('rejects a JSON `null` (not SQL NULL) gateResultSnapshot value via raw SQL', async () => {
        const id = crypto.randomUUID();
        await expect(
          prisma.$executeRawUnsafe(
            `INSERT INTO "QualityRelease" (id, no, "projectId", result, "decisionActorType", "decidedAt", "gateVersion", "gateResultSnapshot", "blockingReasons")
             VALUES ($1, $2, $3, 'NOT_RELEASED', 'SYSTEM', now(), 'v1', 'null'::jsonb, '[]'::jsonb)`,
            id,
            `IT-REL-JSONNULL-${Date.now()}`,
            projectId,
          ),
        ).rejects.toThrow();
      });

      it('rejects a JSON `null` (not SQL NULL) blockingReasons value via raw SQL', async () => {
        const id = crypto.randomUUID();
        await expect(
          prisma.$executeRawUnsafe(
            `INSERT INTO "QualityRelease" (id, no, "projectId", result, "decisionActorType", "decidedAt", "gateVersion", "gateResultSnapshot", "blockingReasons")
             VALUES ($1, $2, $3, 'NOT_RELEASED', 'SYSTEM', now(), 'v1', '{}'::jsonb, 'null'::jsonb)`,
            id,
            `IT-REL-JSONNULL2-${Date.now()}`,
            projectId,
          ),
        ).rejects.toThrow();
      });

      it('rejects gateResultSnapshot stored as a JSON array instead of an object via raw SQL', async () => {
        const id = crypto.randomUUID();
        await expect(
          prisma.$executeRawUnsafe(
            `INSERT INTO "QualityRelease" (id, no, "projectId", result, "decisionActorType", "decidedAt", "gateVersion", "gateResultSnapshot", "blockingReasons")
             VALUES ($1, $2, $3, 'NOT_RELEASED', 'SYSTEM', now(), 'v1', '[]'::jsonb, '[]'::jsonb)`,
            id,
            `IT-REL-WRONGTYPE-${Date.now()}`,
            projectId,
          ),
        ).rejects.toThrow();
      });

      it('rejects blockingReasons stored as a JSON object instead of an array via raw SQL', async () => {
        const id = crypto.randomUUID();
        await expect(
          prisma.$executeRawUnsafe(
            `INSERT INTO "QualityRelease" (id, no, "projectId", result, "decisionActorType", "decidedAt", "gateVersion", "gateResultSnapshot", "blockingReasons")
             VALUES ($1, $2, $3, 'NOT_RELEASED', 'SYSTEM', now(), 'v1', '{}'::jsonb, '{}'::jsonb)`,
            id,
            `IT-REL-WRONGTYPE2-${Date.now()}`,
            projectId,
          ),
        ).rejects.toThrow();
      });
    });
  });

  describe('Blocker 5 / review-correction: QualityHold lifecycle consistency', () => {
    it('rejects PROJECT scope with no projectId', async () => {
      await expect(
        prisma.qualityHold.create({
          data: { no: `IT-H-${Date.now()}-1`, scope: 'PROJECT', appliedActorType: 'SYSTEM', appliedAt: new Date() },
        }),
      ).rejects.toThrow();
    });

    it('rejects PROJECT scope with jobcardId also set', async () => {
      await expect(
        prisma.qualityHold.create({
          data: {
            no: `IT-H-${Date.now()}-2`,
            scope: 'PROJECT',
            projectId,
            jobcardId,
            appliedActorType: 'SYSTEM',
            appliedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects JOBCARD scope with no jobcardId', async () => {
      await expect(
        prisma.qualityHold.create({
          data: { no: `IT-H-${Date.now()}-3`, scope: 'JOBCARD', appliedActorType: 'SYSTEM', appliedAt: new Date() },
        }),
      ).rejects.toThrow();
    });

    it('rejects USER appliedActorType with no appliedById', async () => {
      await expect(
        prisma.qualityHold.create({
          data: { no: `IT-H-${Date.now()}-4`, scope: 'JOBCARD', jobcardId, appliedActorType: 'USER', appliedAt: new Date() },
        }),
      ).rejects.toThrow();
    });

    it('rejects SYSTEM appliedActorType with appliedById set', async () => {
      await expect(
        prisma.qualityHold.create({
          data: {
            no: `IT-H-${Date.now()}-5`,
            scope: 'JOBCARD',
            jobcardId,
            appliedActorType: 'SYSTEM',
            appliedById: userId,
            appliedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('accepts a valid JOBCARD-scoped hold applied by a real USER actor', async () => {
      const hold = await prisma.qualityHold.create({
        data: {
          no: `IT-H-${Date.now()}-6`,
          scope: 'JOBCARD',
          jobcardId,
          appliedActorType: 'USER',
          appliedById: userId,
          appliedAt: new Date(),
        },
      });
      expect(hold.status).toBe('ACTIVE');
      expect(hold.releasedActorType).toBeNull();
    });

    it('rejects inserting a hold directly as RELEASED with no release facts at all', async () => {
      await expect(
        prisma.qualityHold.create({
          data: {
            no: `IT-H-${Date.now()}-7`,
            scope: 'JOBCARD',
            jobcardId,
            status: 'RELEASED',
            appliedActorType: 'SYSTEM',
            appliedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects inserting a hold directly as RELEASED with a blank releaseReason', async () => {
      await expect(
        prisma.qualityHold.create({
          data: {
            no: `IT-H-${Date.now()}-8`,
            scope: 'JOBCARD',
            jobcardId,
            status: 'RELEASED',
            appliedActorType: 'SYSTEM',
            appliedAt: new Date(),
            releasedActorType: 'SYSTEM',
            releasedAt: new Date(),
            releaseReason: '   ',
            releaseEvidenceRef: 'ref-1',
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects populating a release field while status remains ACTIVE (via UPDATE)', async () => {
      const hold = await prisma.qualityHold.create({
        data: { no: `IT-H-${Date.now()}-9`, scope: 'JOBCARD', jobcardId, appliedActorType: 'SYSTEM', appliedAt: new Date() },
      });
      await expect(
        prisma.qualityHold.update({ where: { id: hold.id }, data: { releasedAt: new Date() } }),
      ).rejects.toThrow();
    });

    it('allows a full, valid ACTIVE -> RELEASED transition with USER release actor', async () => {
      const hold = await prisma.qualityHold.create({
        data: { no: `IT-H-${Date.now()}-10`, scope: 'JOBCARD', jobcardId, appliedActorType: 'SYSTEM', appliedAt: new Date() },
      });
      const released = await prisma.qualityHold.update({
        where: { id: hold.id },
        data: {
          status: 'RELEASED',
          releasedActorType: 'USER',
          releasedById: userId,
          releasedAt: new Date(),
          releaseReason: 'fixed',
          releaseEvidenceRef: 'doc-123',
        },
      });
      expect(released.status).toBe('RELEASED');
    });

    it('allows a full, valid ACTIVE -> RELEASED transition with SYSTEM release actor', async () => {
      const hold = await prisma.qualityHold.create({
        data: { no: `IT-H-${Date.now()}-11`, scope: 'JOBCARD', jobcardId, appliedActorType: 'SYSTEM', appliedAt: new Date() },
      });
      const released = await prisma.qualityHold.update({
        where: { id: hold.id },
        data: {
          status: 'RELEASED',
          releasedActorType: 'SYSTEM',
          releasedAt: new Date(),
          releaseReason: 'auto-cleared',
          releaseEvidenceRef: 'auto-check-42',
        },
      });
      expect(released.status).toBe('RELEASED');
    });

    it('rejects changing the release fact once it is set', async () => {
      const hold = await prisma.qualityHold.create({
        data: { no: `IT-H-${Date.now()}-12`, scope: 'JOBCARD', jobcardId, appliedActorType: 'SYSTEM', appliedAt: new Date() },
      });
      await prisma.qualityHold.update({
        where: { id: hold.id },
        data: {
          status: 'RELEASED',
          releasedActorType: 'SYSTEM',
          releasedAt: new Date(),
          releaseReason: 'fixed',
          releaseEvidenceRef: 'ref',
        },
      });
      await expect(
        prisma.qualityHold.update({ where: { id: hold.id }, data: { releaseReason: 'changed my mind' } }),
      ).rejects.toThrow();
    });

    describe('review-correction: full identity immutability — a hold can never be retargeted or reassigned', () => {
      it('allows updatedAt/version-only changes while ACTIVE (technical fields stay free)', async () => {
        const hold = await prisma.qualityHold.create({
          data: { no: `IT-H-IMM-${Date.now()}-ctrl`, scope: 'JOBCARD', jobcardId, appliedActorType: 'SYSTEM', appliedAt: new Date() },
        });
        const updated = await prisma.qualityHold.update({ where: { id: hold.id }, data: { version: { increment: 1 } } });
        expect(updated.version).toBe(hold.version + 1);
      });

      it('rejects changing `no` while ACTIVE', async () => {
        const hold = await prisma.qualityHold.create({
          data: { no: `IT-H-IMM-${Date.now()}-no`, scope: 'JOBCARD', jobcardId, appliedActorType: 'SYSTEM', appliedAt: new Date() },
        });
        await expect(prisma.qualityHold.update({ where: { id: hold.id }, data: { no: `IT-H-IMM-CHANGED-${Date.now()}` } })).rejects.toThrow();
      });

      it('rejects retargeting a JOBCARD-scoped hold to a different jobcardId while ACTIVE', async () => {
        const otherJobcard = await prisma.jobcard.create({ data: { no: `IT-J-IMM-${Date.now()}`, projectId } });
        const hold = await prisma.qualityHold.create({
          data: { no: `IT-H-IMM-${Date.now()}-jc`, scope: 'JOBCARD', jobcardId, appliedActorType: 'SYSTEM', appliedAt: new Date() },
        });
        await expect(prisma.qualityHold.update({ where: { id: hold.id }, data: { jobcardId: otherJobcard.id } })).rejects.toThrow();
      });

      it('rejects retargeting a PROJECT-scoped hold to a different projectId while ACTIVE', async () => {
        const otherCustomer = await prisma.customer.create({ data: { no: `IT-C-IMM-${Date.now()}`, name: 'Imm Co', status: 'ACTIVE' } });
        const otherProject = await prisma.project.create({ data: { no: `IT-P-IMM-${Date.now()}`, customerId: otherCustomer.id, name: 'Imm Project' } });
        const hold = await prisma.qualityHold.create({
          data: { no: `IT-H-IMM-${Date.now()}-proj`, scope: 'PROJECT', projectId, appliedActorType: 'SYSTEM', appliedAt: new Date() },
        });
        await expect(prisma.qualityHold.update({ where: { id: hold.id }, data: { projectId: otherProject.id } })).rejects.toThrow();
      });

      it('rejects changing scope while ACTIVE', async () => {
        const hold = await prisma.qualityHold.create({
          data: { no: `IT-H-IMM-${Date.now()}-scope`, scope: 'JOBCARD', jobcardId, appliedActorType: 'SYSTEM', appliedAt: new Date() },
        });
        await expect(prisma.qualityHold.update({ where: { id: hold.id }, data: { scope: 'PROJECT', projectId } })).rejects.toThrow();
      });

      it('rejects changing ncrId while ACTIVE', async () => {
        const ncr = await prisma.qualityNcr.create({ data: { no: `IT-NCR-IMM-${Date.now()}`, title: 't', category: 'PROCESS', severity: 'MINOR' } });
        const hold = await prisma.qualityHold.create({
          data: { no: `IT-H-IMM-${Date.now()}-ncr`, scope: 'JOBCARD', jobcardId, appliedActorType: 'SYSTEM', appliedAt: new Date() },
        });
        await expect(prisma.qualityHold.update({ where: { id: hold.id }, data: { ncrId: ncr.id } })).rejects.toThrow();
      });

      it('rejects reassigning appliedActorType/appliedById (claiming a different applying actor) while ACTIVE', async () => {
        const hold = await prisma.qualityHold.create({
          data: { no: `IT-H-IMM-${Date.now()}-actor`, scope: 'JOBCARD', jobcardId, appliedActorType: 'SYSTEM', appliedAt: new Date() },
        });
        await expect(
          prisma.qualityHold.update({ where: { id: hold.id }, data: { appliedActorType: 'USER', appliedById: userId } }),
        ).rejects.toThrow();
      });

      it('rejects changing appliedAt while ACTIVE', async () => {
        const hold = await prisma.qualityHold.create({
          data: { no: `IT-H-IMM-${Date.now()}-appliedAt`, scope: 'JOBCARD', jobcardId, appliedActorType: 'SYSTEM', appliedAt: new Date('2026-01-01') },
        });
        await expect(prisma.qualityHold.update({ where: { id: hold.id }, data: { appliedAt: new Date('2026-06-01') } })).rejects.toThrow();
      });

      it('rejects changing createdAt while ACTIVE', async () => {
        const hold = await prisma.qualityHold.create({
          data: { no: `IT-H-IMM-${Date.now()}-createdAt`, scope: 'JOBCARD', jobcardId, appliedActorType: 'SYSTEM', appliedAt: new Date() },
        });
        await expect(prisma.qualityHold.update({ where: { id: hold.id }, data: { createdAt: new Date('2020-01-01') } })).rejects.toThrow();
      });

      it('rejects EVERY update once RELEASED, including identity fields', async () => {
        const hold = await prisma.qualityHold.create({
          data: { no: `IT-H-IMM-${Date.now()}-rel1`, scope: 'JOBCARD', jobcardId, appliedActorType: 'SYSTEM', appliedAt: new Date() },
        });
        await prisma.qualityHold.update({
          where: { id: hold.id },
          data: { status: 'RELEASED', releasedActorType: 'SYSTEM', releasedAt: new Date(), releaseReason: 'fixed', releaseEvidenceRef: 'ref' },
        });
        await expect(prisma.qualityHold.update({ where: { id: hold.id }, data: { no: `IT-H-IMM-RENAMED-${Date.now()}` } })).rejects.toThrow();
      });

      it('rejects EVERY update once RELEASED, even a pure technical version bump', async () => {
        const hold = await prisma.qualityHold.create({
          data: { no: `IT-H-IMM-${Date.now()}-rel2`, scope: 'JOBCARD', jobcardId, appliedActorType: 'SYSTEM', appliedAt: new Date() },
        });
        await prisma.qualityHold.update({
          where: { id: hold.id },
          data: { status: 'RELEASED', releasedActorType: 'SYSTEM', releasedAt: new Date(), releaseReason: 'fixed', releaseEvidenceRef: 'ref' },
        });
        await expect(prisma.qualityHold.update({ where: { id: hold.id }, data: { version: { increment: 1 } } })).rejects.toThrow();
      });
    });
  });

  describe('Blocker 8: AuditLog append-only', () => {
    it('rejects UPDATE and DELETE', async () => {
      const entry = await prisma.auditLog.create({
        data: { entityType: 'HoursEntry', entityId: crypto.randomUUID(), action: 'hours_entry_corrected', userId },
      });
      await expect(prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'tampered' } })).rejects.toThrow();
      await expect(prisma.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow();
    });
  });

  describe('Blocker 9: numeric range, date-order and normalized-code CHECK constraints', () => {
    it('rejects a percentage field above 100', async () => {
      const estimation = await prisma.estimation.create({ data: { no: `IT-EST-${Date.now()}`, customerId, title: 'x' } });
      await expect(
        prisma.estimationLine.create({
          data: { estimationId: estimation.id, category: 'material', description: 'x', qty: '1', unitCost: '1', unitSell: '1', discountPct: '150' },
        }),
      ).rejects.toThrow();
    });

    it('rejects negative quantities', async () => {
      await expect(prisma.inventoryItem.create({ data: { code: `IT-NEG-${Date.now()}`, description: 'x', stock: '-1' } })).rejects.toThrow();
    });

    it('rejects TeamMembership.validTo earlier than validFrom', async () => {
      const site = await prisma.site.create({ data: { name: `it-site-${Date.now()}` } });
      const team = await prisma.team.create({ data: { name: 'it-team', homeSiteId: site.id } });
      await expect(
        prisma.teamMembership.create({
          data: { userId, teamId: team.id, validFrom: new Date('2026-06-01'), validTo: new Date('2026-01-01') },
        }),
      ).rejects.toThrow();
    });

    it('rejects EquipmentUsageSession.meterAfter lower than meterBefore', async () => {
      await expect(
        prisma.equipmentUsageSession.create({
          data: { equipmentId, jobcardId, hours: '1', meterBefore: '100', meterAfter: '50' },
        }),
      ).rejects.toThrow();
    });

    it('rejects an empty/whitespace-only business number', async () => {
      await expect(prisma.customer.create({ data: { no: '   ', name: 'blank no', status: 'ACTIVE' } })).rejects.toThrow();
    });

    it('enforces case-insensitive uniqueness on User.email', async () => {
      const email = `IT-Case-${Date.now()}@Example.invalid`;
      await prisma.user.create({ data: { email, passwordHash: 'x', fullName: 'Case One' } });
      await expect(
        prisma.user.create({ data: { email: email.toLowerCase(), passwordHash: 'x', fullName: 'Case Two' } }),
      ).rejects.toThrow();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R2A-1: User lifecycle, verification, sessions, MFA, Notification, Outbox.
// Implements the approved R2A-1 Implementation Contract (r2-design-review @
// fac7b7d788f3bb6055280900282eaeb35fbd50e1, §4/§5/§8). A separate top-level describe block
// (own PrismaClient, own beforeAll/afterAll) so it is fully independent of the Phase 0A-R1
// suite above.
// ═══════════════════════════════════════════════════════════════════════════
describe('R2A-1 database constraints', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL'] }) });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function uniqueSuffix() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async function createActiveUser(label: string) {
    return prisma.user.create({
      data: {
        email: `it-r2a1-${label}-${uniqueSuffix()}@example.invalid`,
        passwordHash: 'x',
        fullName: `IT R2A1 ${label}`,
        approvalStatus: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
  }

  function sleep(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  async function waitUntil(predicate: () => boolean, timeoutMs = 5000) {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error('waitUntil: condition not met in time');
      await sleep(10);
    }
  }

  async function createPendingEnrollmentWithWebAuthnCredential(label: string) {
    const user = await createActiveUser(label);
    const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'WEBAUTHN' } });
    const credential = await prisma.mfaWebAuthnCredential.create({
      data: { mfaEnrollmentId: enrollment.id, credentialId: `cred-${uniqueSuffix()}`, publicKey: Buffer.from('pk') },
    });
    return { user, enrollment, credential };
  }

  async function createActiveTotpEnrollment(label: string) {
    const user = await createActiveUser(label);
    const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'TOTP' } });
    const credential = await prisma.mfaTotpCredential.create({
      data: { mfaEnrollmentId: enrollment.id, encryptedSecret: Buffer.from('secret'), encryptionKeyVersion: 'v1' },
    });
    await prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { status: 'ACTIVE' } });
    return { user, enrollment, credential };
  }

  // ── User ────────────────────────────────────────────────────────────────
  describe('User: approvalStatus / emailVerifiedAt', () => {
    it('rejects a User inserted as ACTIVE with a null emailVerifiedAt', async () => {
      await expect(
        prisma.user.create({
          data: {
            email: `it-r2a1-active-noverify-${uniqueSuffix()}@example.invalid`,
            passwordHash: 'x',
            fullName: 'x',
            approvalStatus: 'ACTIVE',
          },
        }),
      ).rejects.toThrow();
    });

    it('accepts a User inserted as ACTIVE with emailVerifiedAt set', async () => {
      const user = await createActiveUser('active-ok');
      expect(user.approvalStatus).toBe('ACTIVE');
    });
  });

  // ── UserSession ─────────────────────────────────────────────────────────
  describe('UserSession', () => {
    it('rejects a session for a PENDING_APPROVAL user', async () => {
      const user = await prisma.user.create({
        data: { email: `it-r2a1-pend-${uniqueSuffix()}@example.invalid`, passwordHash: 'x', fullName: 'x' },
      });
      await expect(
        prisma.userSession.create({
          data: { userId: user.id, refreshTokenHash: `rt-${uniqueSuffix()}`, expiresAt: new Date(Date.now() + 3_600_000) },
        }),
      ).rejects.toThrow();
    });

    it('rejects a session for a REJECTED user', async () => {
      const user = await prisma.user.create({
        data: {
          email: `it-r2a1-rej-${uniqueSuffix()}@example.invalid`,
          passwordHash: 'x',
          fullName: 'x',
          approvalStatus: 'REJECTED',
        },
      });
      await expect(
        prisma.userSession.create({
          data: { userId: user.id, refreshTokenHash: `rt-${uniqueSuffix()}`, expiresAt: new Date(Date.now() + 3_600_000) },
        }),
      ).rejects.toThrow();
    });

    it('rejects a session for a SUSPENDED user', async () => {
      const user = await prisma.user.create({
        data: {
          email: `it-r2a1-susp-${uniqueSuffix()}@example.invalid`,
          passwordHash: 'x',
          fullName: 'x',
          approvalStatus: 'SUSPENDED',
        },
      });
      await expect(
        prisma.userSession.create({
          data: { userId: user.id, refreshTokenHash: `rt-${uniqueSuffix()}`, expiresAt: new Date(Date.now() + 3_600_000) },
        }),
      ).rejects.toThrow();
    });

    it('accepts a session for an ACTIVE, verified user', async () => {
      const user = await createActiveUser('sess-ok');
      const session = await prisma.userSession.create({
        data: { userId: user.id, refreshTokenHash: `rt-${uniqueSuffix()}`, expiresAt: new Date(Date.now() + 3_600_000) },
      });
      expect(session.id).toBeDefined();
    });

    it('rejects expiresAt <= createdAt', async () => {
      const user = await createActiveUser('sess-exp');
      await expect(
        prisma.userSession.create({
          data: { userId: user.id, refreshTokenHash: `rt-${uniqueSuffix()}`, expiresAt: new Date(Date.now() - 3_600_000) },
        }),
      ).rejects.toThrow();
    });

    it('rejects revokedAt earlier than createdAt', async () => {
      const user = await createActiveUser('sess-rvk');
      await expect(
        prisma.userSession.create({
          data: {
            userId: user.id,
            refreshTokenHash: `rt-${uniqueSuffix()}`,
            expiresAt: new Date(Date.now() + 3_600_000),
            revokedAt: new Date(Date.now() - 3_600_000),
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects duplicate refreshTokenHash', async () => {
      const user = await createActiveUser('sess-dup');
      const tokenHash = `rt-${uniqueSuffix()}`;
      await prisma.userSession.create({
        data: { userId: user.id, refreshTokenHash: tokenHash, expiresAt: new Date(Date.now() + 3_600_000) },
      });
      await expect(
        prisma.userSession.create({
          data: { userId: user.id, refreshTokenHash: tokenHash, expiresAt: new Date(Date.now() + 3_600_000) },
        }),
      ).rejects.toThrow();
    });

    it('rejects revokedById set with revokedAt NULL', async () => {
      const user = await createActiveUser('sess-actor-only');
      await expect(
        prisma.userSession.create({
          data: {
            userId: user.id,
            refreshTokenHash: `rt-${uniqueSuffix()}`,
            expiresAt: new Date(Date.now() + 3_600_000),
            revokedById: user.id,
          },
        }),
      ).rejects.toThrow();
    });

    it('accepts revokedAt set with revokedById NULL — positive control for the intentional asymmetry', async () => {
      const user = await createActiveUser('sess-auto-revoke');
      // createdAt is set explicitly, safely in the past, rather than relying on the DB's now()
      // default racing against this JS-computed revokedAt over the network round trip.
      const session = await prisma.userSession.create({
        data: {
          userId: user.id,
          refreshTokenHash: `rt-${uniqueSuffix()}`,
          createdAt: new Date(Date.now() - 3_600_000),
          expiresAt: new Date(Date.now() + 3_600_000),
          revokedAt: new Date(),
        },
      });
      expect(session.revokedById).toBeNull();
    });

    describe('userId immutability (ownership bypass fix)', () => {
      it('rejects reassigning to a PENDING_APPROVAL user, and leaves the original session unchanged', async () => {
        const owner = await createActiveUser('sess-owner-vs-pending');
        const target = await prisma.user.create({
          data: { email: `it-r2a1-sess-target-pending-${uniqueSuffix()}@example.invalid`, passwordHash: 'x', fullName: 'x' },
        });
        const session = await prisma.userSession.create({
          data: { userId: owner.id, refreshTokenHash: `rt-${uniqueSuffix()}`, expiresAt: new Date(Date.now() + 3_600_000) },
        });

        await expect(
          prisma.userSession.update({ where: { id: session.id }, data: { userId: target.id } }),
        ).rejects.toThrow();

        const stillOwned = await prisma.userSession.findUniqueOrThrow({ where: { id: session.id } });
        expect(stillOwned.userId).toBe(owner.id);
      });

      it('rejects reassigning to a SUSPENDED user, and leaves the original session unchanged', async () => {
        const owner = await createActiveUser('sess-owner-vs-suspended');
        const target = await prisma.user.create({
          data: {
            email: `it-r2a1-sess-target-suspended-${uniqueSuffix()}@example.invalid`,
            passwordHash: 'x',
            fullName: 'x',
            approvalStatus: 'SUSPENDED',
          },
        });
        const session = await prisma.userSession.create({
          data: { userId: owner.id, refreshTokenHash: `rt-${uniqueSuffix()}`, expiresAt: new Date(Date.now() + 3_600_000) },
        });

        await expect(
          prisma.userSession.update({ where: { id: session.id }, data: { userId: target.id } }),
        ).rejects.toThrow();

        const stillOwned = await prisma.userSession.findUniqueOrThrow({ where: { id: session.id } });
        expect(stillOwned.userId).toBe(owner.id);
      });

      it('rejects reassigning to a REJECTED user, and leaves the original session unchanged', async () => {
        const owner = await createActiveUser('sess-owner-vs-rejected');
        const target = await prisma.user.create({
          data: {
            email: `it-r2a1-sess-target-rejected-${uniqueSuffix()}@example.invalid`,
            passwordHash: 'x',
            fullName: 'x',
            approvalStatus: 'REJECTED',
          },
        });
        const session = await prisma.userSession.create({
          data: { userId: owner.id, refreshTokenHash: `rt-${uniqueSuffix()}`, expiresAt: new Date(Date.now() + 3_600_000) },
        });

        await expect(
          prisma.userSession.update({ where: { id: session.id }, data: { userId: target.id } }),
        ).rejects.toThrow();

        const stillOwned = await prisma.userSession.findUniqueOrThrow({ where: { id: session.id } });
        expect(stillOwned.userId).toBe(owner.id);
      });

      it('rejects reassigning to another ACTIVE user, and leaves the original session unchanged — proves immutability is unconditional, not merely a non-ACTIVE-target guard', async () => {
        const owner = await createActiveUser('sess-owner-vs-active');
        const target = await createActiveUser('sess-target-active');
        const session = await prisma.userSession.create({
          data: { userId: owner.id, refreshTokenHash: `rt-${uniqueSuffix()}`, expiresAt: new Date(Date.now() + 3_600_000) },
        });

        await expect(
          prisma.userSession.update({ where: { id: session.id }, data: { userId: target.id } }),
        ).rejects.toThrow();

        const stillOwned = await prisma.userSession.findUniqueOrThrow({ where: { id: session.id } });
        expect(stillOwned.userId).toBe(owner.id);
      });

      it('accepts an ordinary update that leaves userId unchanged — positive control', async () => {
        const owner = await createActiveUser('sess-noop-update');
        const session = await prisma.userSession.create({
          data: { userId: owner.id, refreshTokenHash: `rt-${uniqueSuffix()}`, expiresAt: new Date(Date.now() + 3_600_000) },
        });
        const updated = await prisma.userSession.update({
          where: { id: session.id },
          data: { userId: owner.id, revokedAt: new Date() },
        });
        expect(updated.userId).toBe(owner.id);
        expect(updated.revokedAt).not.toBeNull();
      });
    });
  });

  // ── EmailVerificationToken ──────────────────────────────────────────────
  describe('EmailVerificationToken', () => {
    it('rejects expiresAt <= createdAt', async () => {
      const user = await createActiveUser('evt-exp');
      await expect(
        prisma.emailVerificationToken.create({
          data: { userId: user.id, tokenHash: `tok-${uniqueSuffix()}`, expiresAt: new Date(Date.now() - 3_600_000) },
        }),
      ).rejects.toThrow();
    });

    it('rejects consumedAt earlier than createdAt', async () => {
      const user = await createActiveUser('evt-consumed-early');
      await expect(
        prisma.emailVerificationToken.create({
          data: {
            userId: user.id,
            tokenHash: `tok-${uniqueSuffix()}`,
            expiresAt: new Date(Date.now() + 3_600_000),
            consumedAt: new Date(Date.now() - 3_600_000),
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects duplicate tokenHash', async () => {
      const user = await createActiveUser('evt-dup');
      const tokenHash = `tok-${uniqueSuffix()}`;
      await prisma.emailVerificationToken.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 3_600_000) },
      });
      await expect(
        prisma.emailVerificationToken.create({
          data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 3_600_000) },
        }),
      ).rejects.toThrow();
    });

    it('rejects consumedAt after expiresAt', async () => {
      const user = await createActiveUser('evt-consumed-late');
      const expiresAt = new Date(Date.now() + 1000);
      await expect(
        prisma.emailVerificationToken.create({
          data: {
            userId: user.id,
            tokenHash: `tok-${uniqueSuffix()}`,
            expiresAt,
            consumedAt: new Date(expiresAt.getTime() + 3_600_000),
          },
        }),
      ).rejects.toThrow();
    });

    it('accepts a well-formed token', async () => {
      const user = await createActiveUser('evt-ok');
      const token = await prisma.emailVerificationToken.create({
        data: { userId: user.id, tokenHash: `tok-${uniqueSuffix()}`, expiresAt: new Date(Date.now() + 3_600_000) },
      });
      expect(token.id).toBeDefined();
    });
  });

  // ── AccessRequest ───────────────────────────────────────────────────────
  describe('AccessRequest', () => {
    function future(ms = 3_600_000) {
      return new Date(Date.now() + ms);
    }

    it('accepts a correctly shaped PENDING row', async () => {
      const user = await createActiveUser('ar-pending-ok');
      const req = await prisma.accessRequest.create({
        data: { userId: user.id, justification: 'need access', expiresAt: future() },
      });
      expect(req.status).toBe('PENDING');
    });

    it('rejects PENDING with decidedById set', async () => {
      const user = await createActiveUser('ar-pending-decider');
      await expect(
        prisma.accessRequest.create({
          data: { userId: user.id, justification: 'x', expiresAt: future(), decidedById: user.id },
        }),
      ).rejects.toThrow();
    });

    it('rejects PENDING with expiredAt set', async () => {
      const user = await createActiveUser('ar-pending-expired-fact');
      await expect(
        prisma.accessRequest.create({
          data: { userId: user.id, justification: 'x', expiresAt: future(), expiredAt: new Date() },
        }),
      ).rejects.toThrow();
    });

    it('accepts a correctly shaped APPROVED row', async () => {
      const user = await createActiveUser('ar-approved-ok');
      const decider = await createActiveUser('ar-approved-decider');
      // createdAt is set explicitly, safely in the past, rather than relying on the DB's now()
      // default racing against this JS-computed decidedAt over the network round trip.
      const req = await prisma.accessRequest.create({
        data: {
          userId: user.id,
          justification: 'x',
          createdAt: new Date(Date.now() - 3_600_000),
          expiresAt: future(),
          status: 'APPROVED',
          decidedById: decider.id,
          decidedAt: new Date(),
        },
      });
      expect(req.status).toBe('APPROVED');
    });

    it('rejects APPROVED with decidedById NULL', async () => {
      const user = await createActiveUser('ar-approved-no-decider');
      await expect(
        prisma.accessRequest.create({
          data: { userId: user.id, justification: 'x', expiresAt: future(), status: 'APPROVED', decidedAt: new Date() },
        }),
      ).rejects.toThrow();
    });

    it('rejects APPROVED with decidedAt NULL', async () => {
      const user = await createActiveUser('ar-approved-no-decidedat');
      await expect(
        prisma.accessRequest.create({
          data: { userId: user.id, justification: 'x', expiresAt: future(), status: 'APPROVED', decidedById: user.id },
        }),
      ).rejects.toThrow();
    });

    it('rejects APPROVED with expiredAt set', async () => {
      const user = await createActiveUser('ar-approved-expired-fact');
      await expect(
        prisma.accessRequest.create({
          data: {
            userId: user.id,
            justification: 'x',
            expiresAt: future(),
            status: 'APPROVED',
            decidedById: user.id,
            decidedAt: new Date(),
            expiredAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('accepts a correctly shaped REJECTED row', async () => {
      const user = await createActiveUser('ar-rejected-ok');
      const req = await prisma.accessRequest.create({
        data: {
          userId: user.id,
          justification: 'x',
          createdAt: new Date(Date.now() - 3_600_000),
          expiresAt: future(),
          status: 'REJECTED',
          decidedById: user.id,
          decidedAt: new Date(),
        },
      });
      expect(req.status).toBe('REJECTED');
    });

    it('rejects REJECTED with decidedById NULL', async () => {
      const user = await createActiveUser('ar-rejected-no-decider');
      await expect(
        prisma.accessRequest.create({
          data: { userId: user.id, justification: 'x', expiresAt: future(), status: 'REJECTED', decidedAt: new Date() },
        }),
      ).rejects.toThrow();
    });

    it('rejects REJECTED with decidedAt NULL', async () => {
      const user = await createActiveUser('ar-rejected-no-decidedat');
      await expect(
        prisma.accessRequest.create({
          data: { userId: user.id, justification: 'x', expiresAt: future(), status: 'REJECTED', decidedById: user.id },
        }),
      ).rejects.toThrow();
    });

    it('accepts a correctly shaped EXPIRED row', async () => {
      // Matches the real lifecycle: a request is created PENDING with expiresAt already reached
      // (as if real time had passed), then the Phase 0B expiry sweep transitions it to EXPIRED
      // via an UPDATE — never inserted directly as EXPIRED. createdAt/expiresAt are both set
      // explicitly, safely in the past, so expiresAt > createdAt holds regardless of DB timing.
      const user = await createActiveUser('ar-expired-ok');
      const req = await prisma.accessRequest.create({
        data: {
          userId: user.id,
          justification: 'x',
          createdAt: new Date(Date.now() - 3_600_000),
          expiresAt: new Date(Date.now() - 1_800_000),
        },
      });
      const expired = await prisma.accessRequest.update({
        where: { id: req.id },
        data: { status: 'EXPIRED', expiredAt: new Date() },
      });
      expect(expired.status).toBe('EXPIRED');
    });

    it('rejects EXPIRED with expiredAt NULL', async () => {
      const user = await createActiveUser('ar-expired-no-fact');
      await expect(
        prisma.accessRequest.create({
          data: { userId: user.id, justification: 'x', expiresAt: new Date(Date.now() - 1000), status: 'EXPIRED' },
        }),
      ).rejects.toThrow();
    });

    it('rejects EXPIRED with decidedById set', async () => {
      const user = await createActiveUser('ar-expired-with-decider');
      await expect(
        prisma.accessRequest.create({
          data: {
            userId: user.id,
            justification: 'x',
            expiresAt: new Date(Date.now() - 1000),
            status: 'EXPIRED',
            expiredAt: new Date(),
            decidedById: user.id,
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects expiredAt earlier than expiresAt', async () => {
      const user = await createActiveUser('ar-expired-too-early');
      const expiresAt = new Date(Date.now() + 3_600_000);
      await expect(
        prisma.accessRequest.create({
          data: { userId: user.id, justification: 'x', expiresAt, status: 'EXPIRED', expiredAt: new Date() },
        }),
      ).rejects.toThrow();
    });

    it('rejects expiresAt <= createdAt', async () => {
      const user = await createActiveUser('ar-expiresAt-order');
      await expect(
        prisma.accessRequest.create({
          data: { userId: user.id, justification: 'x', expiresAt: new Date(Date.now() - 3_600_000) },
        }),
      ).rejects.toThrow();
    });

    it('rejects decidedAt earlier than createdAt', async () => {
      const user = await createActiveUser('ar-decidedAt-order');
      await expect(
        prisma.accessRequest.create({
          data: {
            userId: user.id,
            justification: 'x',
            expiresAt: future(),
            status: 'APPROVED',
            decidedById: user.id,
            decidedAt: new Date(Date.now() - 3_600_000),
          },
        }),
      ).rejects.toThrow();
    });
  });

  // ── UserInvitation ──────────────────────────────────────────────────────
  describe('UserInvitation', () => {
    function future(ms = 3_600_000) {
      return new Date(Date.now() + ms);
    }

    it('accepts a correctly shaped PENDING row', async () => {
      const inviter = await createActiveUser('inv-pending-ok');
      const inv = await prisma.userInvitation.create({
        data: {
          invitedEmail: `invitee-${uniqueSuffix()}@example.invalid`,
          invitedById: inviter.id,
          tokenHash: `inv-${uniqueSuffix()}`,
          expiresAt: future(),
        },
      });
      expect(inv.status).toBe('PENDING');
    });

    it('rejects PENDING with acceptedAt set', async () => {
      const inviter = await createActiveUser('inv-pending-accepted');
      await expect(
        prisma.userInvitation.create({
          data: {
            invitedEmail: `x-${uniqueSuffix()}@example.invalid`,
            invitedById: inviter.id,
            tokenHash: `inv-${uniqueSuffix()}`,
            expiresAt: future(),
            acceptedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects PENDING with revokedAt set', async () => {
      const inviter = await createActiveUser('inv-pending-revokedat');
      await expect(
        prisma.userInvitation.create({
          data: {
            invitedEmail: `x-${uniqueSuffix()}@example.invalid`,
            invitedById: inviter.id,
            tokenHash: `inv-${uniqueSuffix()}`,
            expiresAt: future(),
            revokedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects PENDING with revokedById set', async () => {
      const inviter = await createActiveUser('inv-pending-revokedby');
      await expect(
        prisma.userInvitation.create({
          data: {
            invitedEmail: `x-${uniqueSuffix()}@example.invalid`,
            invitedById: inviter.id,
            tokenHash: `inv-${uniqueSuffix()}`,
            expiresAt: future(),
            revokedById: inviter.id,
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects PENDING with expiredAt set', async () => {
      const inviter = await createActiveUser('inv-pending-expiredat');
      await expect(
        prisma.userInvitation.create({
          data: {
            invitedEmail: `x-${uniqueSuffix()}@example.invalid`,
            invitedById: inviter.id,
            tokenHash: `inv-${uniqueSuffix()}`,
            expiresAt: future(),
            expiredAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('accepts a correctly shaped ACCEPTED row', async () => {
      const inviter = await createActiveUser('inv-accepted-ok');
      // createdAt is set explicitly, safely in the past, rather than relying on the DB's now()
      // default racing against this JS-computed acceptedAt over the network round trip.
      const inv = await prisma.userInvitation.create({
        data: {
          invitedEmail: `x-${uniqueSuffix()}@example.invalid`,
          invitedById: inviter.id,
          tokenHash: `inv-${uniqueSuffix()}`,
          createdAt: new Date(Date.now() - 3_600_000),
          expiresAt: future(),
          status: 'ACCEPTED',
          acceptedAt: new Date(),
        },
      });
      expect(inv.status).toBe('ACCEPTED');
    });

    it('rejects ACCEPTED with acceptedAt NULL', async () => {
      const inviter = await createActiveUser('inv-accepted-no-fact');
      await expect(
        prisma.userInvitation.create({
          data: {
            invitedEmail: `x-${uniqueSuffix()}@example.invalid`,
            invitedById: inviter.id,
            tokenHash: `inv-${uniqueSuffix()}`,
            expiresAt: future(),
            status: 'ACCEPTED',
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects ACCEPTED with revokedAt set (revokedById NULL) — the exact case previously silently passing', async () => {
      const inviter = await createActiveUser('inv-accepted-dangling-revoke');
      await expect(
        prisma.userInvitation.create({
          data: {
            invitedEmail: `x-${uniqueSuffix()}@example.invalid`,
            invitedById: inviter.id,
            tokenHash: `inv-${uniqueSuffix()}`,
            expiresAt: future(),
            status: 'ACCEPTED',
            acceptedAt: new Date(),
            revokedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('accepts a correctly shaped REVOKED row', async () => {
      const inviter = await createActiveUser('inv-revoked-ok');
      const inv = await prisma.userInvitation.create({
        data: {
          invitedEmail: `x-${uniqueSuffix()}@example.invalid`,
          invitedById: inviter.id,
          tokenHash: `inv-${uniqueSuffix()}`,
          createdAt: new Date(Date.now() - 3_600_000),
          expiresAt: future(),
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedById: inviter.id,
        },
      });
      expect(inv.status).toBe('REVOKED');
    });

    it('rejects REVOKED with only revokedAt set (revokedById NULL)', async () => {
      const inviter = await createActiveUser('inv-revoked-only-at');
      await expect(
        prisma.userInvitation.create({
          data: {
            invitedEmail: `x-${uniqueSuffix()}@example.invalid`,
            invitedById: inviter.id,
            tokenHash: `inv-${uniqueSuffix()}`,
            expiresAt: future(),
            status: 'REVOKED',
            revokedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects REVOKED with only revokedById set (revokedAt NULL)', async () => {
      const inviter = await createActiveUser('inv-revoked-only-by');
      await expect(
        prisma.userInvitation.create({
          data: {
            invitedEmail: `x-${uniqueSuffix()}@example.invalid`,
            invitedById: inviter.id,
            tokenHash: `inv-${uniqueSuffix()}`,
            expiresAt: future(),
            status: 'REVOKED',
            revokedById: inviter.id,
          },
        }),
      ).rejects.toThrow();
    });

    it('accepts a correctly shaped EXPIRED row', async () => {
      // Matches the real lifecycle: an invitation is created PENDING with expiresAt already
      // reached (as if real time had passed), then the Phase 0B expiry sweep transitions it to
      // EXPIRED via an UPDATE — never inserted directly as EXPIRED. createdAt/expiresAt are both
      // set explicitly, safely in the past, so expiresAt > createdAt holds regardless of timing.
      const inviter = await createActiveUser('inv-expired-ok');
      const inv = await prisma.userInvitation.create({
        data: {
          invitedEmail: `x-${uniqueSuffix()}@example.invalid`,
          invitedById: inviter.id,
          tokenHash: `inv-${uniqueSuffix()}`,
          createdAt: new Date(Date.now() - 3_600_000),
          expiresAt: new Date(Date.now() - 1_800_000),
        },
      });
      const expired = await prisma.userInvitation.update({
        where: { id: inv.id },
        data: { status: 'EXPIRED', expiredAt: new Date() },
      });
      expect(expired.status).toBe('EXPIRED');
    });

    it('rejects EXPIRED with expiredAt NULL', async () => {
      const inviter = await createActiveUser('inv-expired-no-fact');
      await expect(
        prisma.userInvitation.create({
          data: {
            invitedEmail: `x-${uniqueSuffix()}@example.invalid`,
            invitedById: inviter.id,
            tokenHash: `inv-${uniqueSuffix()}`,
            expiresAt: new Date(Date.now() - 1000),
            status: 'EXPIRED',
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects acceptedAt after expiresAt', async () => {
      const inviter = await createActiveUser('inv-accepted-too-late');
      const expiresAt = new Date(Date.now() + 1000);
      await expect(
        prisma.userInvitation.create({
          data: {
            invitedEmail: `x-${uniqueSuffix()}@example.invalid`,
            invitedById: inviter.id,
            tokenHash: `inv-${uniqueSuffix()}`,
            expiresAt,
            status: 'ACCEPTED',
            acceptedAt: new Date(expiresAt.getTime() + 3_600_000),
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects expiredAt earlier than expiresAt', async () => {
      const inviter = await createActiveUser('inv-expired-too-early');
      const expiresAt = future();
      await expect(
        prisma.userInvitation.create({
          data: {
            invitedEmail: `x-${uniqueSuffix()}@example.invalid`,
            invitedById: inviter.id,
            tokenHash: `inv-${uniqueSuffix()}`,
            expiresAt,
            status: 'EXPIRED',
            expiredAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects expiresAt <= createdAt', async () => {
      const inviter = await createActiveUser('inv-expiresAt-order');
      await expect(
        prisma.userInvitation.create({
          data: {
            invitedEmail: `x-${uniqueSuffix()}@example.invalid`,
            invitedById: inviter.id,
            tokenHash: `inv-${uniqueSuffix()}`,
            expiresAt: new Date(Date.now() - 3_600_000),
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects duplicate tokenHash', async () => {
      const inviter = await createActiveUser('inv-dup');
      const tokenHash = `inv-${uniqueSuffix()}`;
      await prisma.userInvitation.create({
        data: { invitedEmail: `a-${uniqueSuffix()}@example.invalid`, invitedById: inviter.id, tokenHash, expiresAt: future() },
      });
      await expect(
        prisma.userInvitation.create({
          data: { invitedEmail: `b-${uniqueSuffix()}@example.invalid`, invitedById: inviter.id, tokenHash, expiresAt: future() },
        }),
      ).rejects.toThrow();
    });
  });

  // ── MfaEnrollment: state shape, creation constraint, transition graph ─────
  describe('MfaEnrollment: state shape and creation constraint', () => {
    it('defaults a plain insert to PENDING_SETUP — positive control', async () => {
      const user = await createActiveUser('mfa-default');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'TOTP' } });
      expect(enrollment.status).toBe('PENDING_SETUP');
    });

    it('rejects direct INSERT as ACTIVE (TOTP, revocation fields NULL) — the exact bypass this revision closes', async () => {
      const user = await createActiveUser('mfa-direct-active-totp');
      await expect(
        prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'TOTP', status: 'ACTIVE' } }),
      ).rejects.toThrow();
    });

    it('rejects direct INSERT as ACTIVE (WebAuthn, revocation fields NULL)', async () => {
      const user = await createActiveUser('mfa-direct-active-webauthn');
      await expect(
        prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'WEBAUTHN', status: 'ACTIVE' } }),
      ).rejects.toThrow();
    });

    it('rejects direct INSERT as ACTIVE with revocation fields also set', async () => {
      const user = await createActiveUser('mfa-direct-active-revoked-shape');
      await expect(
        prisma.mfaEnrollment.create({
          data: { userId: user.id, method: 'TOTP', status: 'ACTIVE', revokedAt: new Date(), revokedById: user.id },
        }),
      ).rejects.toThrow();
    });

    it('rejects direct INSERT as REVOKED — the creation constraint is not ACTIVE-specific', async () => {
      const user = await createActiveUser('mfa-direct-revoked');
      await expect(
        prisma.mfaEnrollment.create({
          data: { userId: user.id, method: 'TOTP', status: 'REVOKED', revokedAt: new Date(), revokedById: user.id },
        }),
      ).rejects.toThrow();
    });

    it('rejects a PENDING_SETUP/ACTIVE row with only revokedAt set', async () => {
      const user = await createActiveUser('mfa-shape-only-at');
      await expect(
        prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'TOTP', revokedAt: new Date() } }),
      ).rejects.toThrow();
    });

    it('rejects a PENDING_SETUP/ACTIVE row with only revokedById set', async () => {
      const user = await createActiveUser('mfa-shape-only-by');
      await expect(
        prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'TOTP', revokedById: user.id } }),
      ).rejects.toThrow();
    });

    it('rejects a REVOKED row with revokedAt NULL (via raw SQL insert, bypassing the creation-constraint trigger check on status alone)', async () => {
      const user = await createActiveUser('mfa-shape-revoked-no-at');
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "MfaEnrollment" ("id", "userId", "method", "status", "revokedById", "createdAt")
           VALUES (gen_random_uuid(), $1, 'TOTP', 'REVOKED', $1, now())`,
          user.id,
        ),
      ).rejects.toThrow();
    });

    it('rejects a REVOKED row with revokedById NULL', async () => {
      const user = await createActiveUser('mfa-shape-revoked-no-by');
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO "MfaEnrollment" ("id", "userId", "method", "status", "revokedAt", "createdAt")
           VALUES (gen_random_uuid(), $1, 'TOTP', 'REVOKED', now(), now())`,
          user.id,
        ),
      ).rejects.toThrow();
    });
  });

  describe('MfaEnrollment: transition graph', () => {
    it('rejects PENDING_SETUP -> ACTIVE with zero TOTP credentials', async () => {
      const user = await createActiveUser('mfa-trans-totp-zero');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'TOTP' } });
      await expect(
        prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { status: 'ACTIVE' } }),
      ).rejects.toThrow();
    });

    it('rejects PENDING_SETUP -> ACTIVE with zero WebAuthn credentials', async () => {
      const user = await createActiveUser('mfa-trans-webauthn-zero');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'WEBAUTHN' } });
      await expect(
        prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { status: 'ACTIVE' } }),
      ).rejects.toThrow();
    });

    it('accepts PENDING_SETUP -> ACTIVE with exactly one TOTP credential — positive control', async () => {
      const user = await createActiveUser('mfa-trans-totp-one');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'TOTP' } });
      await prisma.mfaTotpCredential.create({
        data: { mfaEnrollmentId: enrollment.id, encryptedSecret: Buffer.from('s'), encryptionKeyVersion: 'v1' },
      });
      const updated = await prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { status: 'ACTIVE' } });
      expect(updated.status).toBe('ACTIVE');
    });

    it('accepts PENDING_SETUP -> ACTIVE with at least one WebAuthn credential — positive control', async () => {
      const user = await createActiveUser('mfa-trans-webauthn-one');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'WEBAUTHN' } });
      await prisma.mfaWebAuthnCredential.create({
        data: { mfaEnrollmentId: enrollment.id, credentialId: `c-${uniqueSuffix()}`, publicKey: Buffer.from('pk') },
      });
      const updated = await prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { status: 'ACTIVE' } });
      expect(updated.status).toBe('ACTIVE');
    });

    it('accepts PENDING_SETUP -> REVOKED — positive control', async () => {
      const user = await createActiveUser('mfa-trans-pending-revoked');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'TOTP' } });
      const updated = await prisma.mfaEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedById: user.id },
      });
      expect(updated.status).toBe('REVOKED');
    });

    it('accepts ACTIVE -> REVOKED — positive control', async () => {
      const { enrollment, user } = await createActiveTotpEnrollment('mfa-trans-active-revoked');
      const updated = await prisma.mfaEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedById: user.id },
      });
      expect(updated.status).toBe('REVOKED');
    });

    it('rejects ACTIVE -> PENDING_SETUP', async () => {
      const { enrollment } = await createActiveTotpEnrollment('mfa-trans-active-to-pending');
      await expect(
        prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { status: 'PENDING_SETUP' } }),
      ).rejects.toThrow();
    });

    it('rejects REVOKED -> ACTIVE', async () => {
      const { enrollment, user } = await createActiveTotpEnrollment('mfa-trans-revoked-to-active');
      await prisma.mfaEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedById: user.id },
      });
      await expect(
        prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { status: 'ACTIVE' } }),
      ).rejects.toThrow();
    });

    it('rejects REVOKED -> PENDING_SETUP', async () => {
      const { enrollment, user } = await createActiveTotpEnrollment('mfa-trans-revoked-to-pending');
      await prisma.mfaEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedById: user.id },
      });
      await expect(
        prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { status: 'PENDING_SETUP' } }),
      ).rejects.toThrow();
    });

    it('rejects UPDATE ... SET method on a PENDING_SETUP row', async () => {
      const user = await createActiveUser('mfa-method-immutable-pending');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'TOTP' } });
      await expect(
        prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { method: 'WEBAUTHN' } }),
      ).rejects.toThrow();
    });

    it('rejects UPDATE ... SET method on an ACTIVE row', async () => {
      const { enrollment } = await createActiveTotpEnrollment('mfa-method-immutable-active');
      await expect(
        prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { method: 'WEBAUTHN' } }),
      ).rejects.toThrow();
    });
  });

  describe('MfaEnrollment: userId immutability (ownership bypass fix)', () => {
    it('rejects reassigning userId on a PENDING_SETUP row, and leaves the owner and credential unchanged', async () => {
      const owner = await createActiveUser('mfa-owner-pending');
      const otherUser = await createActiveUser('mfa-owner-pending-target');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: owner.id, method: 'TOTP' } });
      const credential = await prisma.mfaTotpCredential.create({
        data: { mfaEnrollmentId: enrollment.id, encryptedSecret: Buffer.from('s'), encryptionKeyVersion: 'v1' },
      });

      await expect(
        prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { userId: otherUser.id } }),
      ).rejects.toThrow();

      const stillOwned = await prisma.mfaEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
      expect(stillOwned.userId).toBe(owner.id);
      expect(stillOwned.status).toBe('PENDING_SETUP');
      const survivingCredential = await prisma.mfaTotpCredential.findUniqueOrThrow({ where: { id: credential.id } });
      expect(survivingCredential.mfaEnrollmentId).toBe(enrollment.id);
    });

    it('rejects reassigning userId on an ACTIVE row, and leaves the owner and credential unchanged', async () => {
      const { enrollment, user, credential } = await createActiveTotpEnrollment('mfa-owner-active');
      const otherUser = await createActiveUser('mfa-owner-active-target');

      await expect(
        prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { userId: otherUser.id } }),
      ).rejects.toThrow();

      const stillOwned = await prisma.mfaEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
      expect(stillOwned.userId).toBe(user.id);
      expect(stillOwned.status).toBe('ACTIVE');
      const survivingCredential = await prisma.mfaTotpCredential.findUniqueOrThrow({ where: { id: credential.id } });
      expect(survivingCredential.mfaEnrollmentId).toBe(enrollment.id);
    });

    it('rejects reassigning userId on a REVOKED row, and leaves the owner and credential unchanged', async () => {
      const { enrollment, user, credential } = await createActiveTotpEnrollment('mfa-owner-revoked');
      await prisma.mfaEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedById: user.id },
      });
      const otherUser = await createActiveUser('mfa-owner-revoked-target');

      await expect(
        prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { userId: otherUser.id } }),
      ).rejects.toThrow();

      const stillOwned = await prisma.mfaEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
      expect(stillOwned.userId).toBe(user.id);
      expect(stillOwned.status).toBe('REVOKED');
      const survivingCredential = await prisma.mfaTotpCredential.findUniqueOrThrow({ where: { id: credential.id } });
      expect(survivingCredential.mfaEnrollmentId).toBe(enrollment.id);
    });

    it('accepts an ordinary update that leaves userId unchanged — positive control', async () => {
      const owner = await createActiveUser('mfa-owner-noop');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: owner.id, method: 'TOTP' } });
      const updated = await prisma.mfaEnrollment.update({
        where: { id: enrollment.id },
        data: { userId: owner.id, method: 'TOTP' },
      });
      expect(updated.userId).toBe(owner.id);
    });
  });

  describe('MfaEnrollment: REVOKED same-status revocation-fact immutability (corrected fixture)', () => {
    it('rejects REVOKED -> REVOKED changing revokedAt to a different timestamp', async () => {
      const { enrollment, user } = await createActiveTotpEnrollment('mfa-revoke-immut-at');
      const revoked = await prisma.mfaEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedById: user.id },
      });
      await expect(
        prisma.mfaEnrollment.update({
          where: { id: enrollment.id },
          data: { revokedAt: new Date(revoked.revokedAt!.getTime() + 60_000) },
        }),
      ).rejects.toThrow();
    });

    it('rejects REVOKED -> REVOKED changing revokedById to a different user', async () => {
      const { enrollment, user } = await createActiveTotpEnrollment('mfa-revoke-immut-by');
      const otherUser = await createActiveUser('mfa-revoke-immut-by-other');
      await prisma.mfaEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedById: user.id },
      });
      await expect(
        prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { revokedById: otherUser.id } }),
      ).rejects.toThrow();
    });

    it('accepts an ordinary ACTIVE -> ACTIVE value-preserving update — positive control', async () => {
      const { enrollment } = await createActiveTotpEnrollment('mfa-active-noop');
      const updated = await prisma.mfaEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'ACTIVE', revokedAt: null, revokedById: null },
      });
      expect(updated.status).toBe('ACTIVE');
      expect(updated.revokedAt).toBeNull();
    });
  });

  // ── MfaTotpCredential ───────────────────────────────────────────────────
  describe('MfaTotpCredential', () => {
    it('rejects a duplicate mfaEnrollmentId', async () => {
      const user = await createActiveUser('totp-dup-enrollment');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'TOTP' } });
      await prisma.mfaTotpCredential.create({
        data: { mfaEnrollmentId: enrollment.id, encryptedSecret: Buffer.from('s1'), encryptionKeyVersion: 'v1' },
      });
      await expect(
        prisma.mfaTotpCredential.create({
          data: { mfaEnrollmentId: enrollment.id, encryptedSecret: Buffer.from('s2'), encryptionKeyVersion: 'v1' },
        }),
      ).rejects.toThrow();
    });

    it('rejects insert against a WEBAUTHN-method enrollment', async () => {
      const user = await createActiveUser('totp-wrong-method');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'WEBAUTHN' } });
      await expect(
        prisma.mfaTotpCredential.create({
          data: { mfaEnrollmentId: enrollment.id, encryptedSecret: Buffer.from('s'), encryptionKeyVersion: 'v1' },
        }),
      ).rejects.toThrow();
    });

    it('rejects an empty encryptedSecret', async () => {
      const user = await createActiveUser('totp-empty-secret');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'TOTP' } });
      await expect(
        prisma.mfaTotpCredential.create({
          data: { mfaEnrollmentId: enrollment.id, encryptedSecret: Buffer.alloc(0), encryptionKeyVersion: 'v1' },
        }),
      ).rejects.toThrow();
    });

    it('rejects a blank encryptionKeyVersion', async () => {
      const user = await createActiveUser('totp-empty-keyversion');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'TOTP' } });
      await expect(
        prisma.mfaTotpCredential.create({
          data: { mfaEnrollmentId: enrollment.id, encryptedSecret: Buffer.from('s'), encryptionKeyVersion: '   ' },
        }),
      ).rejects.toThrow();
    });

    it('rejects insert against a REVOKED enrollment', async () => {
      const user = await createActiveUser('totp-revoked-enrollment');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'TOTP' } });
      await prisma.mfaEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedById: user.id },
      });
      await expect(
        prisma.mfaTotpCredential.create({
          data: { mfaEnrollmentId: enrollment.id, encryptedSecret: Buffer.from('s'), encryptionKeyVersion: 'v1' },
        }),
      ).rejects.toThrow();
    });

    it('rejects deleting the sole credential of an ACTIVE enrollment', async () => {
      const { credential } = await createActiveTotpEnrollment('totp-delete-active');
      await expect(prisma.mfaTotpCredential.delete({ where: { id: credential.id } })).rejects.toThrow();
    });

    it('rejects UPDATE mfaEnrollmentId to a different TOTP enrollment, and leaves the original untouched', async () => {
      const { enrollment, credential } = await createActiveTotpEnrollment('totp-reassign-totp');
      const otherUser = await createActiveUser('totp-reassign-totp-target');
      const otherEnrollment = await prisma.mfaEnrollment.create({ data: { userId: otherUser.id, method: 'TOTP' } });

      await expect(
        prisma.mfaTotpCredential.update({ where: { id: credential.id }, data: { mfaEnrollmentId: otherEnrollment.id } }),
      ).rejects.toThrow();

      const stillThere = await prisma.mfaTotpCredential.findUniqueOrThrow({ where: { id: credential.id } });
      expect(stillThere.mfaEnrollmentId).toBe(enrollment.id);
    });

    it('rejects UPDATE mfaEnrollmentId to a WebAuthn enrollment, and leaves the original untouched', async () => {
      const { enrollment, credential } = await createActiveTotpEnrollment('totp-reassign-webauthn');
      const otherUser = await createActiveUser('totp-reassign-webauthn-target');
      const webauthnEnrollment = await prisma.mfaEnrollment.create({ data: { userId: otherUser.id, method: 'WEBAUTHN' } });

      await expect(
        prisma.mfaTotpCredential.update({ where: { id: credential.id }, data: { mfaEnrollmentId: webauthnEnrollment.id } }),
      ).rejects.toThrow();

      const stillThere = await prisma.mfaTotpCredential.findUniqueOrThrow({ where: { id: credential.id } });
      expect(stillThere.mfaEnrollmentId).toBe(enrollment.id);
    });
  });

  // ── MfaWebAuthnCredential ───────────────────────────────────────────────
  describe('MfaWebAuthnCredential', () => {
    it('rejects insert against a TOTP-method enrollment', async () => {
      const user = await createActiveUser('webauthn-wrong-method');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'TOTP' } });
      await expect(
        prisma.mfaWebAuthnCredential.create({
          data: { mfaEnrollmentId: enrollment.id, credentialId: `c-${uniqueSuffix()}`, publicKey: Buffer.from('pk') },
        }),
      ).rejects.toThrow();
    });

    it('rejects a duplicate credentialId under a different enrollment', async () => {
      const { enrollment: e1 } = await createPendingEnrollmentWithWebAuthnCredential('webauthn-dup-cred-1');
      const c1 = await prisma.mfaWebAuthnCredential.findFirstOrThrow({ where: { mfaEnrollmentId: e1.id } });
      const user2 = await createActiveUser('webauthn-dup-cred-2');
      const e2 = await prisma.mfaEnrollment.create({ data: { userId: user2.id, method: 'WEBAUTHN' } });
      await expect(
        prisma.mfaWebAuthnCredential.create({
          data: { mfaEnrollmentId: e2.id, credentialId: c1.credentialId, publicKey: Buffer.from('pk2') },
        }),
      ).rejects.toThrow();
    });

    it('rejects an empty publicKey', async () => {
      const user = await createActiveUser('webauthn-empty-key');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'WEBAUTHN' } });
      await expect(
        prisma.mfaWebAuthnCredential.create({
          data: { mfaEnrollmentId: enrollment.id, credentialId: `c-${uniqueSuffix()}`, publicKey: Buffer.alloc(0) },
        }),
      ).rejects.toThrow();
    });

    it('accepts a second WebAuthn credential for the same enrollment with a different credentialId — positive control', async () => {
      const { enrollment } = await createPendingEnrollmentWithWebAuthnCredential('webauthn-second-cred');
      const second = await prisma.mfaWebAuthnCredential.create({
        data: { mfaEnrollmentId: enrollment.id, credentialId: `c2-${uniqueSuffix()}`, publicKey: Buffer.from('pk2') },
      });
      expect(second.id).toBeDefined();
    });

    it('rejects insert against a REVOKED enrollment', async () => {
      const user = await createActiveUser('webauthn-revoked-enrollment');
      const enrollment = await prisma.mfaEnrollment.create({ data: { userId: user.id, method: 'WEBAUTHN' } });
      await prisma.mfaEnrollment.update({
        where: { id: enrollment.id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedById: user.id },
      });
      await expect(
        prisma.mfaWebAuthnCredential.create({
          data: { mfaEnrollmentId: enrollment.id, credentialId: `c-${uniqueSuffix()}`, publicKey: Buffer.from('pk') },
        }),
      ).rejects.toThrow();
    });

    it('rejects deleting the last credential of an ACTIVE enrollment', async () => {
      const { enrollment, credential } = await createPendingEnrollmentWithWebAuthnCredential('webauthn-delete-last');
      await prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { status: 'ACTIVE' } });
      await expect(prisma.mfaWebAuthnCredential.delete({ where: { id: credential.id } })).rejects.toThrow();
    });

    it('accepts deleting one of two credentials of an ACTIVE enrollment, leaving one — positive control', async () => {
      const { enrollment, credential } = await createPendingEnrollmentWithWebAuthnCredential('webauthn-delete-one-of-two');
      const second = await prisma.mfaWebAuthnCredential.create({
        data: { mfaEnrollmentId: enrollment.id, credentialId: `c2-${uniqueSuffix()}`, publicKey: Buffer.from('pk2') },
      });
      await prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { status: 'ACTIVE' } });
      await prisma.mfaWebAuthnCredential.delete({ where: { id: credential.id } });
      const remaining = await prisma.mfaWebAuthnCredential.findUniqueOrThrow({ where: { id: second.id } });
      expect(remaining.id).toBe(second.id);
    });

    it('rejects UPDATE mfaEnrollmentId to a different WebAuthn enrollment, and leaves the original untouched', async () => {
      const { enrollment, credential } = await createPendingEnrollmentWithWebAuthnCredential('webauthn-reassign-webauthn');
      const otherUser = await createActiveUser('webauthn-reassign-webauthn-target');
      const otherEnrollment = await prisma.mfaEnrollment.create({ data: { userId: otherUser.id, method: 'WEBAUTHN' } });

      await expect(
        prisma.mfaWebAuthnCredential.update({
          where: { id: credential.id },
          data: { mfaEnrollmentId: otherEnrollment.id },
        }),
      ).rejects.toThrow();

      const stillThere = await prisma.mfaWebAuthnCredential.findUniqueOrThrow({ where: { id: credential.id } });
      expect(stillThere.mfaEnrollmentId).toBe(enrollment.id);
    });

    it('rejects UPDATE mfaEnrollmentId to a TOTP enrollment, and leaves the original untouched', async () => {
      const { enrollment, credential } = await createPendingEnrollmentWithWebAuthnCredential('webauthn-reassign-totp');
      const otherUser = await createActiveUser('webauthn-reassign-totp-target');
      const totpEnrollment = await prisma.mfaEnrollment.create({ data: { userId: otherUser.id, method: 'TOTP' } });

      await expect(
        prisma.mfaWebAuthnCredential.update({ where: { id: credential.id }, data: { mfaEnrollmentId: totpEnrollment.id } }),
      ).rejects.toThrow();

      const stillThere = await prisma.mfaWebAuthnCredential.findUniqueOrThrow({ where: { id: credential.id } });
      expect(stillThere.mfaEnrollmentId).toBe(enrollment.id);
    });

    it('accepts an ordinary signCount update — positive control proving legitimate non-parent updates remain possible', async () => {
      const { credential } = await createPendingEnrollmentWithWebAuthnCredential('webauthn-signcount');
      const updated = await prisma.mfaWebAuthnCredential.update({
        where: { id: credential.id },
        data: { signCount: credential.signCount + 1n },
      });
      expect(updated.signCount).toBe(credential.signCount + 1n);
    });
  });

  // ── MFA concurrency-locking protocol (corrected fixtures) ───────────────
  describe('MFA concurrency-locking protocol', () => {
    it('scenario 1 (deletion racing activation), commit variant: activation sees zero credentials and is rejected', async () => {
      const { enrollment, credential } = await createPendingEnrollmentWithWebAuthnCredential('conc-s1-commit');

      let releaseA!: () => void;
      const aMayCommit = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      let aDeleted = false;

      const aTx = prisma.$transaction(
        async (tx) => {
          await tx.mfaWebAuthnCredential.delete({ where: { id: credential.id } });
          aDeleted = true;
          await aMayCommit;
        },
        { maxWait: 10_000, timeout: 10_000 },
      );

      await waitUntil(() => aDeleted);

      let bSettled = false;
      const bTx = prisma
        .$transaction(
          async (tx) => tx.mfaEnrollment.update({ where: { id: enrollment.id }, data: { status: 'ACTIVE' } }),
          { maxWait: 10_000, timeout: 10_000 },
        )
        .finally(() => {
          bSettled = true;
        });

      await sleep(300);
      expect(bSettled).toBe(false); // B is genuinely blocked behind A's still-open lock

      releaseA();
      await aTx;
      await expect(bTx).rejects.toThrow();
    });

    it('scenario 1, rollback variant: activation succeeds once the delete is undone', async () => {
      const { enrollment, credential } = await createPendingEnrollmentWithWebAuthnCredential('conc-s1-rollback');

      let releaseA!: (commit: boolean) => void;
      const aOutcome = new Promise<void>((resolve, reject) => {
        releaseA = (commit) => (commit ? resolve() : reject(new Error('deliberate rollback')));
      });
      let aDeleted = false;

      const aTx = prisma
        .$transaction(
          async (tx) => {
            await tx.mfaWebAuthnCredential.delete({ where: { id: credential.id } });
            aDeleted = true;
            await aOutcome;
          },
          { maxWait: 10_000, timeout: 10_000 },
        )
        .catch(() => undefined);

      await waitUntil(() => aDeleted);

      let bSettled = false;
      const bTx = prisma
        .$transaction(
          async (tx) => tx.mfaEnrollment.update({ where: { id: enrollment.id }, data: { status: 'ACTIVE' } }),
          { maxWait: 10_000, timeout: 10_000 },
        )
        .finally(() => {
          bSettled = true;
        });

      await sleep(300);
      expect(bSettled).toBe(false);

      releaseA(false); // roll back A — the deletion never happened
      await aTx;
      const bResult = await bTx;
      expect(bResult.status).toBe('ACTIVE');

      const survivingCredential = await prisma.mfaWebAuthnCredential.findUnique({ where: { id: credential.id } });
      expect(survivingCredential).not.toBeNull();
    });

    it('scenario 2 (activation racing deletion), commit variant: deletion sees ACTIVE and is rejected', async () => {
      const { enrollment, credential } = await createPendingEnrollmentWithWebAuthnCredential('conc-s2-commit');

      let releaseA!: () => void;
      const aMayCommit = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      let aActivated = false;

      const aTx = prisma.$transaction(
        async (tx) => {
          await tx.mfaEnrollment.update({ where: { id: enrollment.id }, data: { status: 'ACTIVE' } });
          aActivated = true;
          await aMayCommit;
        },
        { maxWait: 10_000, timeout: 10_000 },
      );

      await waitUntil(() => aActivated);

      let bSettled = false;
      const bTx = prisma
        .$transaction(async (tx) => tx.mfaWebAuthnCredential.delete({ where: { id: credential.id } }), {
          maxWait: 10_000,
          timeout: 10_000,
        })
        .finally(() => {
          bSettled = true;
        });

      await sleep(300);
      expect(bSettled).toBe(false); // B is genuinely blocked behind A's still-open lock

      releaseA();
      await aTx;
      await expect(bTx).rejects.toThrow();
    });

    it('scenario 2, rollback variant: deletion succeeds, enrollment remains PENDING_SETUP', async () => {
      const { enrollment, credential } = await createPendingEnrollmentWithWebAuthnCredential('conc-s2-rollback');

      let releaseA!: (commit: boolean) => void;
      const aOutcome = new Promise<void>((resolve, reject) => {
        releaseA = (commit) => (commit ? resolve() : reject(new Error('deliberate rollback')));
      });
      let aActivated = false;

      const aTx = prisma
        .$transaction(
          async (tx) => {
            await tx.mfaEnrollment.update({ where: { id: enrollment.id }, data: { status: 'ACTIVE' } });
            aActivated = true;
            await aOutcome;
          },
          { maxWait: 10_000, timeout: 10_000 },
        )
        .catch(() => undefined);

      await waitUntil(() => aActivated);

      let bSettled = false;
      const bTx = prisma
        .$transaction(async (tx) => tx.mfaWebAuthnCredential.delete({ where: { id: credential.id } }), {
          maxWait: 10_000,
          timeout: 10_000,
        })
        .finally(() => {
          bSettled = true;
        });

      await sleep(300);
      expect(bSettled).toBe(false);

      releaseA(false); // roll back A — activation never happened
      await aTx;
      await bTx; // deletion succeeds now that E is still PENDING_SETUP

      const finalEnrollment = await prisma.mfaEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
      expect(finalEnrollment.status).toBe('PENDING_SETUP');
    });

    it('a short lock_timeout probe demonstrates genuine blocking and aborts cleanly rather than resuming on its own', async () => {
      const { enrollment, credential } = await createPendingEnrollmentWithWebAuthnCredential('conc-lock-timeout');

      let releaseA!: () => void;
      const aMayCommit = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      let aDeleted = false;

      const aTx = prisma.$transaction(
        async (tx) => {
          await tx.mfaWebAuthnCredential.delete({ where: { id: credential.id } });
          aDeleted = true;
          await aMayCommit;
        },
        { maxWait: 10_000, timeout: 10_000 },
      );

      await waitUntil(() => aDeleted);

      // Probe: a short lock_timeout, expected to fail with a lock-timeout error while A still
      // holds the lock. This transaction is aborted by that failure and cannot be reused.
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '200ms'`);
          await tx.mfaEnrollment.update({ where: { id: enrollment.id }, data: { status: 'ACTIVE' } });
        }),
      ).rejects.toThrow();

      // The probe's failure did not affect A, which is still open and still holding the lock.
      releaseA();
      await aTx;

      // A fresh attempt, issued only after A resolved, with no artificially short timeout,
      // proceeds consistently with A's outcome (A committed the delete, so activation is
      // correctly rejected for zero credentials) — proving the probe did not "resume" on its own.
      await expect(
        prisma.mfaEnrollment.update({ where: { id: enrollment.id }, data: { status: 'ACTIVE' } }),
      ).rejects.toThrow();
    });
  });

  // ── MfaRecoveryCode ─────────────────────────────────────────────────────
  describe('MfaRecoveryCode', () => {
    it('rejects a duplicate codeHash', async () => {
      const user = await createActiveUser('recovery-dup');
      const codeHash = `rc-${uniqueSuffix()}`;
      await prisma.mfaRecoveryCode.create({ data: { userId: user.id, codeHash } });
      await expect(prisma.mfaRecoveryCode.create({ data: { userId: user.id, codeHash } })).rejects.toThrow();
    });

    it('rejects usedAt earlier than createdAt', async () => {
      const user = await createActiveUser('recovery-used-early');
      await expect(
        prisma.mfaRecoveryCode.create({
          data: { userId: user.id, codeHash: `rc-${uniqueSuffix()}`, usedAt: new Date(Date.now() - 3_600_000) },
        }),
      ).rejects.toThrow();
    });
  });

  // ── Notification ────────────────────────────────────────────────────────
  describe('Notification', () => {
    it('rejects a non-object payload', async () => {
      const user = await createActiveUser('notif-bad-payload');
      await expect(
        prisma.notification.create({
          data: { recipientUserId: user.id, kind: 'test', payload: ['not', 'an', 'object'] },
        }),
      ).rejects.toThrow();
    });

    it('rejects readAt earlier than createdAt', async () => {
      const user = await createActiveUser('notif-read-early');
      await expect(
        prisma.notification.create({
          data: { recipientUserId: user.id, kind: 'test', readAt: new Date(Date.now() - 3_600_000) },
        }),
      ).rejects.toThrow();
    });

    it('accepts a well-formed notification with the default empty-object payload', async () => {
      const user = await createActiveUser('notif-ok');
      const notif = await prisma.notification.create({ data: { recipientUserId: user.id, kind: 'test' } });
      expect(notif.payload).toEqual({});
    });
  });

  // ── OutboxEvent ─────────────────────────────────────────────────────────
  describe('OutboxEvent', () => {
    function base() {
      return { aggregateType: 'TestAggregate', aggregateId: crypto.randomUUID(), eventType: 'test.event', payload: { a: 1 } };
    }

    it('accepts a correctly shaped PENDING row', async () => {
      const event = await prisma.outboxEvent.create({
        data: { ...base(), idempotencyKey: `idem-${uniqueSuffix()}` },
      });
      expect(event.status).toBe('PENDING');
    });

    it('rejects PENDING with lockedAt set', async () => {
      await expect(
        prisma.outboxEvent.create({
          data: { ...base(), idempotencyKey: `idem-${uniqueSuffix()}`, lockedAt: new Date() },
        }),
      ).rejects.toThrow();
    });

    it('rejects PENDING with lastError set', async () => {
      await expect(
        prisma.outboxEvent.create({
          data: { ...base(), idempotencyKey: `idem-${uniqueSuffix()}`, lastError: 'boom' },
        }),
      ).rejects.toThrow();
    });

    it('accepts a correctly shaped PROCESSING row', async () => {
      // createdAt is set explicitly, safely in the past, rather than relying on the DB's now()
      // default racing against this JS-computed lockedAt over the network round trip.
      const event = await prisma.outboxEvent.create({
        data: {
          ...base(),
          idempotencyKey: `idem-${uniqueSuffix()}`,
          createdAt: new Date(Date.now() - 7_200_000),
          status: 'PROCESSING',
          lockedAt: new Date(),
          lockedBy: 'dispatcher-1',
        },
      });
      expect(event.status).toBe('PROCESSING');
    });

    it('rejects PROCESSING with lockedBy NULL (only lockedAt set)', async () => {
      await expect(
        prisma.outboxEvent.create({
          data: { ...base(), idempotencyKey: `idem-${uniqueSuffix()}`, status: 'PROCESSING', lockedAt: new Date() },
        }),
      ).rejects.toThrow();
    });

    it('rejects PROCESSING with lockedAt NULL (only lockedBy set)', async () => {
      await expect(
        prisma.outboxEvent.create({
          data: { ...base(), idempotencyKey: `idem-${uniqueSuffix()}`, status: 'PROCESSING', lockedBy: 'dispatcher-1' },
        }),
      ).rejects.toThrow();
    });

    it('accepts a correctly shaped SENT row', async () => {
      // createdAt is set explicitly, safely in the past, rather than relying on the DB's now()
      // default racing against this JS-computed processedAt over the network round trip.
      const event = await prisma.outboxEvent.create({
        data: {
          ...base(),
          idempotencyKey: `idem-${uniqueSuffix()}`,
          createdAt: new Date(Date.now() - 7_200_000),
          status: 'SENT',
          processedAt: new Date(),
        },
      });
      expect(event.status).toBe('SENT');
    });

    it('rejects SENT with lastError set', async () => {
      await expect(
        prisma.outboxEvent.create({
          data: {
            ...base(),
            idempotencyKey: `idem-${uniqueSuffix()}`,
            status: 'SENT',
            processedAt: new Date(),
            lastError: 'stale error',
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects SENT with lockedAt set', async () => {
      await expect(
        prisma.outboxEvent.create({
          data: {
            ...base(),
            idempotencyKey: `idem-${uniqueSuffix()}`,
            status: 'SENT',
            processedAt: new Date(),
            lockedAt: new Date(),
            lockedBy: 'dispatcher-1',
          },
        }),
      ).rejects.toThrow();
    });

    it('accepts a correctly shaped FAILED row', async () => {
      const event = await prisma.outboxEvent.create({
        data: {
          ...base(),
          idempotencyKey: `idem-${uniqueSuffix()}`,
          status: 'FAILED',
          lastError: 'boom',
          nextAttemptAt: new Date(Date.now() + 60_000),
        },
      });
      expect(event.status).toBe('FAILED');
    });

    it('rejects FAILED with lastError NULL', async () => {
      await expect(
        prisma.outboxEvent.create({
          data: {
            ...base(),
            idempotencyKey: `idem-${uniqueSuffix()}`,
            status: 'FAILED',
            nextAttemptAt: new Date(Date.now() + 60_000),
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects FAILED with nextAttemptAt NULL', async () => {
      await expect(
        prisma.outboxEvent.create({
          data: { ...base(), idempotencyKey: `idem-${uniqueSuffix()}`, status: 'FAILED', lastError: 'boom' },
        }),
      ).rejects.toThrow();
    });

    it('rejects FAILED with lockedAt set', async () => {
      await expect(
        prisma.outboxEvent.create({
          data: {
            ...base(),
            idempotencyKey: `idem-${uniqueSuffix()}`,
            status: 'FAILED',
            lastError: 'boom',
            nextAttemptAt: new Date(Date.now() + 60_000),
            lockedAt: new Date(),
            lockedBy: 'dispatcher-1',
          },
        }),
      ).rejects.toThrow();
    });

    it('accepts a correctly shaped DEAD_LETTER row', async () => {
      // createdAt is set explicitly, safely in the past, rather than relying on the DB's now()
      // default racing against this JS-computed deadLetteredAt over the network round trip.
      const event = await prisma.outboxEvent.create({
        data: {
          ...base(),
          idempotencyKey: `idem-${uniqueSuffix()}`,
          createdAt: new Date(Date.now() - 7_200_000),
          status: 'DEAD_LETTER',
          lastError: 'boom',
          deadLetteredAt: new Date(),
        },
      });
      expect(event.status).toBe('DEAD_LETTER');
    });

    it('rejects DEAD_LETTER with deadLetteredAt NULL', async () => {
      await expect(
        prisma.outboxEvent.create({
          data: { ...base(), idempotencyKey: `idem-${uniqueSuffix()}`, status: 'DEAD_LETTER', lastError: 'boom' },
        }),
      ).rejects.toThrow();
    });

    it('rejects DEAD_LETTER with lastError NULL', async () => {
      await expect(
        prisma.outboxEvent.create({
          data: { ...base(), idempotencyKey: `idem-${uniqueSuffix()}`, status: 'DEAD_LETTER', deadLetteredAt: new Date() },
        }),
      ).rejects.toThrow();
    });

    it('rejects DEAD_LETTER with nextAttemptAt set', async () => {
      await expect(
        prisma.outboxEvent.create({
          data: {
            ...base(),
            idempotencyKey: `idem-${uniqueSuffix()}`,
            status: 'DEAD_LETTER',
            lastError: 'boom',
            deadLetteredAt: new Date(),
            nextAttemptAt: new Date(Date.now() + 60_000),
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects a duplicate idempotencyKey', async () => {
      const idempotencyKey = `idem-${uniqueSuffix()}`;
      await prisma.outboxEvent.create({ data: { ...base(), idempotencyKey } });
      await expect(prisma.outboxEvent.create({ data: { ...base(), idempotencyKey } })).rejects.toThrow();
    });

    it('rejects a non-object payload', async () => {
      await expect(
        prisma.outboxEvent.create({
          data: { ...base(), idempotencyKey: `idem-${uniqueSuffix()}`, payload: 'not-an-object' },
        }),
      ).rejects.toThrow();
    });

    it('rejects a negative attemptCount', async () => {
      await expect(
        prisma.outboxEvent.create({
          data: { ...base(), idempotencyKey: `idem-${uniqueSuffix()}`, attemptCount: -1 },
        }),
      ).rejects.toThrow();
    });

    it('rejects processedAt earlier than createdAt', async () => {
      await expect(
        prisma.outboxEvent.create({
          data: {
            ...base(),
            idempotencyKey: `idem-${uniqueSuffix()}`,
            status: 'SENT',
            processedAt: new Date(Date.now() - 3_600_000),
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects deadLetteredAt earlier than createdAt', async () => {
      await expect(
        prisma.outboxEvent.create({
          data: {
            ...base(),
            idempotencyKey: `idem-${uniqueSuffix()}`,
            status: 'DEAD_LETTER',
            lastError: 'boom',
            deadLetteredAt: new Date(Date.now() - 3_600_000),
          },
        }),
      ).rejects.toThrow();
    });
  });
});
