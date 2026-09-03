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
