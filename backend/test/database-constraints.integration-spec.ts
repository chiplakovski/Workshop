import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/prisma/client.js';

// Exercises the Phase 0A-R1 database-level protections (CHECK constraints, append-only triggers,
// functional unique indexes) directly against a real PostgreSQL database — the things Prisma's
// schema language cannot express and so cannot be caught by `prisma validate` or the unit tests.
// Requires DATABASE_URL to point at a database with the current migration applied.
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

  describe('Blocker 3: SafetyEvent integrity', () => {
    it('accepts a USER-actor gate decision with exactly the matching target', async () => {
      const evt = await prisma.safetyEvent.create({
        data: { kind: 'EQUIPMENT_BLOCK', equipmentId, gateVersion: 'v1', actorType: 'USER', userId },
      });
      expect(evt.id).toBeDefined();
    });

    it('accepts a SYSTEM actor with no userId', async () => {
      const evt = await prisma.safetyEvent.create({
        data: { kind: 'EQUIPMENT_PASS', equipmentId, gateVersion: 'v1', actorType: 'SYSTEM' },
      });
      expect(evt.id).toBeDefined();
    });

    it('rejects a USER actor with no userId (no anonymous safety actions)', async () => {
      await expect(
        prisma.safetyEvent.create({ data: { kind: 'EQUIPMENT_PASS', equipmentId, gateVersion: 'v1', actorType: 'USER' } }),
      ).rejects.toThrow();
    });

    it('rejects a SYSTEM actor with a userId set', async () => {
      await expect(
        prisma.safetyEvent.create({
          data: { kind: 'EQUIPMENT_PASS', equipmentId, gateVersion: 'v1', actorType: 'SYSTEM', userId },
        }),
      ).rejects.toThrow();
    });

    it('rejects a gate-decision kind with no target', async () => {
      await expect(
        prisma.safetyEvent.create({ data: { kind: 'EQUIPMENT_BLOCK', gateVersion: 'v1', actorType: 'SYSTEM' } }),
      ).rejects.toThrow();
    });

    it('rejects a gate-decision kind with the wrong target type', async () => {
      await expect(
        prisma.safetyEvent.create({
          data: { kind: 'EQUIPMENT_BLOCK', gateVersion: 'v1', actorType: 'SYSTEM', qualityHoldId: crypto.randomUUID() },
        }),
      ).rejects.toThrow();
    });

    it('remains append-only: rejects UPDATE and DELETE', async () => {
      const evt = await prisma.safetyEvent.create({
        data: { kind: 'EQUIPMENT_BLOCK', equipmentId, gateVersion: 'v1', actorType: 'SYSTEM' },
      });
      await expect(prisma.safetyEvent.update({ where: { id: evt.id }, data: { gateVersion: 'v2' } })).rejects.toThrow();
      await expect(prisma.safetyEvent.delete({ where: { id: evt.id } })).rejects.toThrow();
    });
  });

  describe('Blocker 4: QualityRelease immutable evidence', () => {
    it('rejects UPDATE and DELETE on an existing release', async () => {
      const release = await prisma.qualityRelease.create({
        data: { no: `IT-REL-${Date.now()}`, projectId, result: 'NOT_RELEASED', gateVersion: 'v1' },
      });
      await expect(prisma.qualityRelease.update({ where: { id: release.id }, data: { result: 'RELEASED' } })).rejects.toThrow();
      await expect(prisma.qualityRelease.delete({ where: { id: release.id } })).rejects.toThrow();
    });

    it('rejects a release whose previousVersionId is its own id', async () => {
      const id = crypto.randomUUID();
      await expect(
        prisma.qualityRelease.create({
          data: { id, no: `IT-REL-BAD-${Date.now()}`, projectId, result: 'RELEASED', gateVersion: 'v1', previousVersionId: id },
        }),
      ).rejects.toThrow();
    });

    it('allows a new release to legitimately supersede a different one', async () => {
      const original = await prisma.qualityRelease.create({
        data: { no: `IT-REL-${Date.now()}-orig`, projectId, result: 'NOT_RELEASED', gateVersion: 'v1' },
      });
      const replacement = await prisma.qualityRelease.create({
        data: {
          no: `IT-REL-${Date.now()}-new`,
          projectId,
          result: 'RELEASED',
          gateVersion: 'v2',
          releasedById: userId,
          releasedAt: new Date(),
          previousVersionId: original.id,
        },
      });
      expect(replacement.previousVersionId).toBe(original.id);
    });
  });

  describe('Blocker 5: QualityHold target scope and release immutability', () => {
    it('rejects PROJECT scope with no projectId', async () => {
      await expect(prisma.qualityHold.create({ data: { no: `IT-H-${Date.now()}-1`, scope: 'PROJECT' } })).rejects.toThrow();
    });

    it('rejects PROJECT scope with jobcardId also set', async () => {
      await expect(
        prisma.qualityHold.create({ data: { no: `IT-H-${Date.now()}-2`, scope: 'PROJECT', projectId, jobcardId } }),
      ).rejects.toThrow();
    });

    it('rejects JOBCARD scope with no jobcardId', async () => {
      await expect(prisma.qualityHold.create({ data: { no: `IT-H-${Date.now()}-3`, scope: 'JOBCARD' } })).rejects.toThrow();
    });

    it('accepts a valid JOBCARD-scoped hold and allows the one release transition', async () => {
      const hold = await prisma.qualityHold.create({
        data: { no: `IT-H-${Date.now()}-4`, scope: 'JOBCARD', jobcardId, appliedById: userId, appliedAt: new Date() },
      });
      const released = await prisma.qualityHold.update({
        where: { id: hold.id },
        data: { status: 'RELEASED', releasedById: userId, releasedAt: new Date(), releaseReason: 'fixed' },
      });
      expect(released.status).toBe('RELEASED');
    });

    it('rejects changing the release fact once it is set', async () => {
      const hold = await prisma.qualityHold.create({
        data: { no: `IT-H-${Date.now()}-5`, scope: 'JOBCARD', jobcardId },
      });
      await prisma.qualityHold.update({
        where: { id: hold.id },
        data: { status: 'RELEASED', releasedById: userId, releasedAt: new Date(), releaseReason: 'fixed' },
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
