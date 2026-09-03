-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'QUOTATION', 'APPROVED', 'PLANNED', 'ACTIVE', 'HOLD', 'COMPLETED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobcardStatus" AS ENUM ('DRAFT', 'RELEASED', 'READY', 'IN_PROGRESS', 'INSPECTION', 'COMPLETED', 'CLOSED', 'PAUSED', 'BLOCKED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "JobcardOperationStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "EstimationStatus" AS ENUM ('DRAFT', 'REVIEW', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PurchaseRfqStatus" AS ENUM ('DRAFT', 'SENT', 'REPLIED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CustomerInvoiceStatus" AS ENUM ('DRAFT', 'PENDING', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'PREFERRED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EquipmentStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'IN_USE', 'OUT_OF_SERVICE', 'QUARANTINED', 'UNDER_MAINTENANCE', 'MAINTENANCE_DUE', 'INSPECTION_REQUIRED', 'RETIRED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'VALID', 'APPROVED', 'REVIEW_SOON', 'EXPIRED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('DOCUMENT', 'CERTIFICATE', 'DRAWING', 'REPORT', 'TEMPLATE', 'IMAGE');

-- CreateEnum
CREATE TYPE "QualityInspectionType" AS ENUM ('INCOMING_MATERIAL', 'VISUAL', 'DIMENSIONAL', 'FITUP', 'WELDING', 'FINAL', 'FUNCTIONAL', 'PRESSURE', 'LEAK', 'COATING', 'CUSTOMER', 'SUPPLIER', 'PRE_DELIVERY', 'RETURN_TO_SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "QualityInspectionStatus" AS ENUM ('DRAFT', 'REQUESTED', 'PLANNED', 'READY', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'COMPLETED', 'REINSPECTION_REQUIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QualityInspectionResult" AS ENUM ('PENDING', 'PASSED', 'PASSED_OBSERVATIONS', 'FAILED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "WeldProcess" AS ENUM ('TIG', 'MIG', 'MAG', 'MMA', 'FCAW', 'SAW', 'OTHER');

-- CreateEnum
CREATE TYPE "WeldStatus" AS ENUM ('PLANNED', 'READY', 'IN_PROGRESS', 'AWAITING_VISUAL', 'AWAITING_NDT', 'ACCEPTED', 'REPAIR_REQUIRED', 'REPAIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NdtMethod" AS ENUM ('VT', 'PT', 'MT', 'UT', 'RT', 'LEAK', 'PRESSURE', 'OTHER');

-- CreateEnum
CREATE TYPE "NdtStatus" AS ENUM ('REQUIRED', 'REQUESTED', 'PLANNED', 'IN_PROGRESS', 'WAITING_REPORT', 'ACCEPTED', 'REJECTED', 'REINSPECTION_REQUIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NdtResult" AS ENUM ('PENDING', 'ACCEPTED', 'ACCEPTED_OBSERVATIONS', 'REJECTED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "NcrCategory" AS ENUM ('MATERIAL', 'DIMENSION', 'WELDING', 'DOCUMENTATION', 'SUPPLIER', 'PROCESS', 'EQUIPMENT', 'SURFACE_COATING', 'CUSTOMER_REQUIREMENT', 'TRACEABILITY', 'SAFETY', 'OTHER');

-- CreateEnum
CREATE TYPE "NcrSeverity" AS ENUM ('MINOR', 'MAJOR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "NcrStatus" AS ENUM ('DRAFT', 'OPEN', 'CONTAINMENT_REQUIRED', 'UNDER_INVESTIGATION', 'DISPOSITION_REQUIRED', 'CORRECTIVE_ACTION', 'WAITING_VERIFICATION', 'CLOSED', 'REJECTED', 'REOPENED');

-- CreateEnum
CREATE TYPE "NcrDisposition" AS ENUM ('REWORK', 'REPAIR', 'USE_AS_IS', 'RETURN_TO_SUPPLIER', 'SCRAP', 'REPLACE', 'RECLASSIFY', 'PENDING');

-- CreateEnum
CREATE TYPE "CapaStatus" AS ENUM ('OPEN', 'PLANNED', 'IN_PROGRESS', 'WAITING_EVIDENCE', 'WAITING_VERIFICATION', 'EFFECTIVE', 'INEFFECTIVE', 'CLOSED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "QualityHoldScope" AS ENUM ('PROJECT', 'JOBCARD');

-- CreateEnum
CREATE TYPE "QualityHoldStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('RECEIVED', 'ACKNOWLEDGED', 'UNDER_INVESTIGATION', 'CORRECTIVE_ACTION', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "ItpLinePointType" AS ENUM ('HOLD', 'WITNESS', 'REVIEW', 'SURVEILLANCE');

-- CreateEnum
CREATE TYPE "ItpLineStatus" AS ENUM ('OPEN', 'RESOLVED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "FinalReleaseResult" AS ENUM ('RELEASED', 'RELEASED_WITH_CONDITIONS', 'NOT_RELEASED');

-- CreateEnum
CREATE TYPE "SupplierQualityApprovalStatus" AS ENUM ('APPROVED', 'CONDITIONALLY_APPROVED', 'UNDER_REVIEW', 'SUSPENDED', 'NOT_APPROVED');

-- CreateEnum
CREATE TYPE "MarketingLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "MarketingOpportunityStage" AS ENUM ('DISCOVERY', 'QUALIFIED', 'RFQ', 'PREPARING', 'QUOTE_SENT', 'NEGOTIATION', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'PLANNED');

-- CreateEnum
CREATE TYPE "SavedReportType" AS ENUM ('VIEW', 'CUSTOM');

-- CreateEnum
CREATE TYPE "StockMovementAction" AS ENUM ('RECEIVED', 'ISSUED', 'RESERVED', 'RETURN', 'SCRAP', 'TRANSFER', 'ADJUSTED');

-- CreateEnum
CREATE TYPE "OffcutStatus" AS ENUM ('AVAILABLE', 'USED');

-- CreateEnum
CREATE TYPE "SafetyEventKind" AS ENUM ('EQUIPMENT_BLOCK', 'EQUIPMENT_PASS', 'HOLD_APPLY', 'HOLD_RELEASE', 'RELEASE_GRANT', 'RELEASE_REJECT', 'DOCUMENT_SUPERSEDED');

-- CreateEnum
CREATE TYPE "SafetyActorType" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ReconciliationResolution" AS ENUM ('PENDING', 'AUTO_MATCHED', 'MANUALLY_RESOLVED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "fullName" VARCHAR(200) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(150) NOT NULL,
    "description" VARCHAR(500),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "homeSiteId" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupervisorSiteAssignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupervisorSiteAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupervisorTeamAssignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupervisorTeamAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupervisorProjectAssignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupervisorProjectAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupervisorJobcardAssignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "jobcardId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupervisorJobcardAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "org" VARCHAR(60),
    "vat" VARCHAR(60),
    "email" VARCHAR(254),
    "phone" VARCHAR(60),
    "terms" VARCHAR(100),
    "credit" DECIMAL(14,2),
    "currency" CHAR(3),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerContact" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "customerId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "role" VARCHAR(100),
    "email" VARCHAR(254),
    "phone" VARCHAR(60),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "CustomerContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingLead" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "MarketingLeadStatus" NOT NULL DEFAULT 'NEW',
    "priority" VARCHAR(20),
    "source" VARCHAR(40),
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "customerId" UUID,
    "linkedOpportunityId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "MarketingLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingOpportunity" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stage" "MarketingOpportunityStage" NOT NULL DEFAULT 'DISCOVERY',
    "probability" INTEGER,
    "customerId" UUID NOT NULL,
    "estimationId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MarketingOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'PLANNED',
    "channels" TEXT[],
    "targetIndustries" TEXT[],
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estimation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "customerId" UUID NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "status" "EstimationStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "sellingPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'SEK',
    "projectId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Estimation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimationLine" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "estimationId" UUID NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "unitSell" DECIMAL(14,4) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "taxPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "wastePct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "EstimationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "customerId" UUID NOT NULL,
    "status" "CustomerInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "value" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'SEK',
    "dueDate" DATE,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "customerId" UUID NOT NULL,
    "siteId" UUID,
    "name" VARCHAR(300) NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "phase" VARCHAR(40),
    "plannedHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "usedHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "materialStatus" VARCHAR(30),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectBomLine" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "projectId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "required" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "issued" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ProjectBomLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Jobcard" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "projectId" UUID NOT NULL,
    "siteId" UUID,
    "status" "JobcardStatus" NOT NULL DEFAULT 'DRAFT',
    "materialReadiness" VARCHAR(30),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Jobcard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobcardOperation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jobcardId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "status" "JobcardOperationStatus" NOT NULL DEFAULT 'PENDING',
    "plannedHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "loggedHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "dependencyId" UUID,
    "equipmentId" UUID,
    "assignedUserId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "JobcardOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobcardWorker" (
    "jobcardId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobcardWorker_pkey" PRIMARY KEY ("jobcardId","userId")
);

-- CreateTable
CREATE TABLE "HoursEntry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jobcardId" UUID NOT NULL,
    "operationId" UUID,
    "userId" UUID NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL,
    "workDate" DATE NOT NULL,
    "billable" BOOLEAN,
    "overtime" BOOLEAN,
    "notes" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "HoursEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobcardInspectionLegacy" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "jobcardId" UUID NOT NULL,
    "legacyType" VARCHAR(60) NOT NULL,
    "legacyStatus" VARCHAR(60) NOT NULL,
    "legacyResult" VARCHAR(60),
    "legacyDate" DATE,
    "migratedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobcardInspectionLegacy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(60) NOT NULL,
    "description" VARCHAR(300) NOT NULL,
    "stock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "minStock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "avgCost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'SEK',
    "supplierId" UUID,
    "status" VARCHAR(20),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryLot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inventoryItemId" UUID NOT NULL,
    "lotNumber" VARCHAR(100) NOT NULL,
    "supplierId" UUID,
    "receivedDate" DATE,
    "certificateRef" VARCHAR(200),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inventoryItemId" UUID NOT NULL,
    "action" "StockMovementAction" NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "projectId" UUID,
    "jobcardId" UUID,
    "userId" UUID,
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offcut" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(60) NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "status" "OffcutStatus" NOT NULL DEFAULT 'AVAILABLE',
    "sourceProjectId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Offcut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inventoryItemId" UUID NOT NULL,
    "counted" DECIMAL(12,3) NOT NULL,
    "systemQty" DECIMAL(12,3) NOT NULL,
    "difference" DECIMAL(12,3) NOT NULL,
    "scope" VARCHAR(60),
    "userId" UUID,
    "countedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarcodeLink" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "barcode" VARCHAR(100) NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "supplierId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BarcodeLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "supplierId" UUID NOT NULL,
    "projectId" UUID,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'SEK',
    "receivedQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "receivedValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "expectedDate" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRfq" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "supplierId" UUID NOT NULL,
    "status" "PurchaseRfqStatus" NOT NULL DEFAULT 'DRAFT',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "PurchaseRfq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "supplierId" UUID NOT NULL,
    "purchaseOrderId" UUID,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'SEK',
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequisition" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "projectId" UUID,
    "status" "RequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedById" UUID,
    "approvedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseRequisition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequisitionLine" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "requisitionId" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "qtyRequested" DECIMAL(12,3) NOT NULL,
    "sourceBomLineId" UUID,
    "purchaseOrderId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "PurchaseRequisitionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Equipment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "equipmentId" VARCHAR(60) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "EquipmentStatus" NOT NULL DEFAULT 'AVAILABLE',
    "qrCode" VARCHAR(100),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentInspection" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "equipmentId" UUID NOT NULL,
    "result" VARCHAR(30) NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "EquipmentInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentBreakdown" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "equipmentId" UUID NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "EquipmentBreakdown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentPreUseCheck" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "equipmentId" UUID NOT NULL,
    "checkDate" DATE NOT NULL,
    "result" VARCHAR(20) NOT NULL,
    "jobcardId" UUID,
    "projectId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentPreUseCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EquipmentUsageSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "equipmentId" UUID NOT NULL,
    "jobcardId" UUID NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL,
    "meterBefore" DECIMAL(12,2),
    "meterAfter" DECIMAL(12,2),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EquipmentUsageSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityInspection" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "jobcardId" UUID,
    "projectId" UUID,
    "type" "QualityInspectionType" NOT NULL,
    "status" "QualityInspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "result" "QualityInspectionResult" NOT NULL DEFAULT 'PENDING',
    "plannedDate" DATE,
    "actualDate" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QualityInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityWeld" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "jobcardId" UUID,
    "projectId" UUID,
    "process" "WeldProcess" NOT NULL,
    "status" "WeldStatus" NOT NULL DEFAULT 'PLANNED',
    "finalResult" VARCHAR(20),
    "weldDate" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "QualityWeld_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityNdt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "weldId" UUID,
    "inspectionId" UUID,
    "method" "NdtMethod" NOT NULL,
    "status" "NdtStatus" NOT NULL DEFAULT 'REQUIRED',
    "result" "NdtResult" NOT NULL DEFAULT 'PENDING',
    "inspectionDate" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "QualityNdt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityNcr" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "projectId" UUID,
    "jobcardId" UUID,
    "supplierId" UUID,
    "customerId" UUID,
    "capaId" UUID,
    "category" "NcrCategory" NOT NULL,
    "severity" "NcrSeverity" NOT NULL,
    "status" "NcrStatus" NOT NULL DEFAULT 'DRAFT',
    "disposition" "NcrDisposition",
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QualityNcr_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityCapa" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "status" "CapaStatus" NOT NULL DEFAULT 'OPEN',
    "fiveWhys" TEXT[],
    "fishbone" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "QualityCapa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityHold" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "scope" "QualityHoldScope" NOT NULL,
    "projectId" UUID,
    "jobcardId" UUID,
    "ncrId" UUID,
    "status" "QualityHoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "appliedActorType" "SafetyActorType" NOT NULL,
    "appliedById" UUID,
    "appliedAt" TIMESTAMPTZ NOT NULL,
    "releasedActorType" "SafetyActorType",
    "releasedById" UUID,
    "releasedAt" TIMESTAMPTZ,
    "releaseReason" VARCHAR(1000),
    "releaseEvidenceRef" VARCHAR(500),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QualityHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityWps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "QualityWps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityWelderQual" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "welderId" UUID,
    "welderName" VARCHAR(200) NOT NULL,
    "process" VARCHAR(30) NOT NULL,
    "expiryDate" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "QualityWelderQual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityComplaint" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "customerId" UUID NOT NULL,
    "projectId" UUID,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'RECEIVED',
    "severity" "NcrSeverity",
    "ncrId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "QualityComplaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityDossier" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "projectId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "QualityDossier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityDossierItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dossierId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" VARCHAR(30) NOT NULL,
    "reference" VARCHAR(300),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "QualityDossierItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityItp" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "projectId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "QualityItp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityItpLine" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "itpId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "pointType" "ItpLinePointType" NOT NULL,
    "status" "ItpLineStatus" NOT NULL DEFAULT 'OPEN',
    "result" VARCHAR(30),
    "plannedDate" DATE,
    "actualDate" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "QualityItpLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualityRelease" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "no" VARCHAR(40) NOT NULL,
    "projectId" UUID NOT NULL,
    "jobcardId" UUID,
    "result" "FinalReleaseResult" NOT NULL,
    "decisionActorType" "SafetyActorType" NOT NULL,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ NOT NULL,
    "gateVersion" VARCHAR(40) NOT NULL,
    "gateResultSnapshot" JSONB NOT NULL,
    "blockingReasons" JSONB NOT NULL DEFAULT '[]',
    "previousVersionId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QualityRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierQuality" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "supplierId" UUID NOT NULL,
    "approvalStatus" "SupplierQualityApprovalStatus" NOT NULL DEFAULT 'UNDER_REVIEW',
    "openNcrs" INTEGER NOT NULL DEFAULT 0,
    "rating" DECIMAL(3,2),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "SupplierQuality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(300) NOT NULL,
    "type" "DocumentType" NOT NULL DEFAULT 'DOCUMENT',
    "category" VARCHAR(100),
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "storageKey" VARCHAR(500),
    "mimeType" VARCHAR(150),
    "fileSize" BIGINT,
    "checksum" VARCHAR(128),
    "uploadedById" UUID,
    "previousVersionId" UUID,
    "supersededAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentFolder" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "projectId" UUID,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "DocumentFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentCustomer" (
    "documentId" UUID NOT NULL,
    "customerId" UUID NOT NULL,

    CONSTRAINT "DocumentCustomer_pkey" PRIMARY KEY ("documentId","customerId")
);

-- CreateTable
CREATE TABLE "DocumentSupplier" (
    "documentId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,

    CONSTRAINT "DocumentSupplier_pkey" PRIMARY KEY ("documentId","supplierId")
);

-- CreateTable
CREATE TABLE "DocumentProject" (
    "documentId" UUID NOT NULL,
    "projectId" UUID NOT NULL,

    CONSTRAINT "DocumentProject_pkey" PRIMARY KEY ("documentId","projectId")
);

-- CreateTable
CREATE TABLE "DocumentJobcard" (
    "documentId" UUID NOT NULL,
    "jobcardId" UUID NOT NULL,

    CONSTRAINT "DocumentJobcard_pkey" PRIMARY KEY ("documentId","jobcardId")
);

-- CreateTable
CREATE TABLE "DocumentEquipment" (
    "documentId" UUID NOT NULL,
    "equipmentId" UUID NOT NULL,

    CONSTRAINT "DocumentEquipment_pkey" PRIMARY KEY ("documentId","equipmentId")
);

-- CreateTable
CREATE TABLE "DocumentPurchaseOrder" (
    "documentId" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,

    CONSTRAINT "DocumentPurchaseOrder_pkey" PRIMARY KEY ("documentId","purchaseOrderId")
);

-- CreateTable
CREATE TABLE "QualityInspectionDocument" (
    "documentId" UUID NOT NULL,
    "qualityInspectionId" UUID NOT NULL,

    CONSTRAINT "QualityInspectionDocument_pkey" PRIMARY KEY ("documentId","qualityInspectionId")
);

-- CreateTable
CREATE TABLE "NcrDocument" (
    "documentId" UUID NOT NULL,
    "ncrId" UUID NOT NULL,

    CONSTRAINT "NcrDocument_pkey" PRIMARY KEY ("documentId","ncrId")
);

-- CreateTable
CREATE TABLE "QualityHoldDocument" (
    "documentId" UUID NOT NULL,
    "qualityHoldId" UUID NOT NULL,

    CONSTRAINT "QualityHoldDocument_pkey" PRIMARY KEY ("documentId","qualityHoldId")
);

-- CreateTable
CREATE TABLE "WpsDocument" (
    "documentId" UUID NOT NULL,
    "qualityWpsId" UUID NOT NULL,

    CONSTRAINT "WpsDocument_pkey" PRIMARY KEY ("documentId","qualityWpsId")
);

-- CreateTable
CREATE TABLE "WelderQualificationDocument" (
    "documentId" UUID NOT NULL,
    "qualityWelderQualId" UUID NOT NULL,

    CONSTRAINT "WelderQualificationDocument_pkey" PRIMARY KEY ("documentId","qualityWelderQualId")
);

-- CreateTable
CREATE TABLE "NdtRecordDocument" (
    "documentId" UUID NOT NULL,
    "qualityNdtId" UUID NOT NULL,

    CONSTRAINT "NdtRecordDocument_pkey" PRIMARY KEY ("documentId","qualityNdtId")
);

-- CreateTable
CREATE TABLE "FinalReleaseDocument" (
    "documentId" UUID NOT NULL,
    "qualityReleaseId" UUID NOT NULL,

    CONSTRAINT "FinalReleaseDocument_pkey" PRIMARY KEY ("documentId","qualityReleaseId")
);

-- CreateTable
CREATE TABLE "InventoryLotDocument" (
    "documentId" UUID NOT NULL,
    "inventoryLotId" UUID NOT NULL,

    CONSTRAINT "InventoryLotDocument_pkey" PRIMARY KEY ("documentId","inventoryLotId")
);

-- CreateTable
CREATE TABLE "SavedReport" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "type" "SavedReportType" NOT NULL DEFAULT 'VIEW',
    "favourite" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "definition" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "SavedReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entityType" VARCHAR(60) NOT NULL,
    "entityId" VARCHAR(100) NOT NULL,
    "action" VARCHAR(200) NOT NULL,
    "fromValue" VARCHAR(500),
    "toValue" VARCHAR(500),
    "reference" VARCHAR(200),
    "reason" VARCHAR(1000),
    "userId" UUID,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "SafetyEventKind" NOT NULL,
    "equipmentId" UUID,
    "qualityHoldId" UUID,
    "qualityReleaseId" UUID,
    "previousDocumentId" UUID,
    "newDocumentId" UUID,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "gateVersion" VARCHAR(40) NOT NULL,
    "decisionSnapshot" JSONB NOT NULL,
    "actorType" "SafetyActorType" NOT NULL,
    "userId" UUID,

    CONSTRAINT "SafetyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationReconciliationRecord" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sourceCollection" VARCHAR(100) NOT NULL,
    "sourceKey" VARCHAR(300) NOT NULL,
    "candidateMatches" JSONB,
    "resolution" "ReconciliationResolution" NOT NULL DEFAULT 'PENDING',
    "resolvedById" UUID,
    "resolvedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationReconciliationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_active_idx" ON "User"("active");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_name_key" ON "Site"("name");

-- CreateIndex
CREATE INDEX "Team_homeSiteId_idx" ON "Team"("homeSiteId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_homeSiteId_key" ON "Team"("name", "homeSiteId");

-- CreateIndex
CREATE INDEX "TeamMembership_userId_idx" ON "TeamMembership"("userId");

-- CreateIndex
CREATE INDEX "TeamMembership_teamId_idx" ON "TeamMembership"("teamId");

-- CreateIndex
CREATE INDEX "TeamMembership_active_idx" ON "TeamMembership"("active");

-- CreateIndex
CREATE INDEX "SupervisorSiteAssignment_siteId_idx" ON "SupervisorSiteAssignment"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "SupervisorSiteAssignment_userId_siteId_key" ON "SupervisorSiteAssignment"("userId", "siteId");

-- CreateIndex
CREATE INDEX "SupervisorTeamAssignment_teamId_idx" ON "SupervisorTeamAssignment"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "SupervisorTeamAssignment_userId_teamId_key" ON "SupervisorTeamAssignment"("userId", "teamId");

-- CreateIndex
CREATE INDEX "SupervisorProjectAssignment_projectId_idx" ON "SupervisorProjectAssignment"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SupervisorProjectAssignment_userId_projectId_key" ON "SupervisorProjectAssignment"("userId", "projectId");

-- CreateIndex
CREATE INDEX "SupervisorJobcardAssignment_jobcardId_idx" ON "SupervisorJobcardAssignment"("jobcardId");

-- CreateIndex
CREATE UNIQUE INDEX "SupervisorJobcardAssignment_userId_jobcardId_key" ON "SupervisorJobcardAssignment"("userId", "jobcardId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_no_key" ON "Customer"("no");

-- CreateIndex
CREATE INDEX "Customer_status_idx" ON "Customer"("status");

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE INDEX "CustomerContact_customerId_idx" ON "CustomerContact"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingLead_linkedOpportunityId_key" ON "MarketingLead"("linkedOpportunityId");

-- CreateIndex
CREATE INDEX "MarketingLead_status_idx" ON "MarketingLead"("status");

-- CreateIndex
CREATE INDEX "MarketingLead_customerId_idx" ON "MarketingLead"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingOpportunity_estimationId_key" ON "MarketingOpportunity"("estimationId");

-- CreateIndex
CREATE INDEX "MarketingOpportunity_stage_idx" ON "MarketingOpportunity"("stage");

-- CreateIndex
CREATE INDEX "MarketingOpportunity_customerId_idx" ON "MarketingOpportunity"("customerId");

-- CreateIndex
CREATE INDEX "MarketingCampaign_status_idx" ON "MarketingCampaign"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Estimation_no_key" ON "Estimation"("no");

-- CreateIndex
CREATE UNIQUE INDEX "Estimation_projectId_key" ON "Estimation"("projectId");

-- CreateIndex
CREATE INDEX "Estimation_status_idx" ON "Estimation"("status");

-- CreateIndex
CREATE INDEX "Estimation_customerId_idx" ON "Estimation"("customerId");

-- CreateIndex
CREATE INDEX "EstimationLine_estimationId_idx" ON "EstimationLine"("estimationId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_no_key" ON "Invoice"("no");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_no_key" ON "Project"("no");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Project_customerId_idx" ON "Project"("customerId");

-- CreateIndex
CREATE INDEX "Project_siteId_idx" ON "Project"("siteId");

-- CreateIndex
CREATE INDEX "ProjectBomLine_projectId_idx" ON "ProjectBomLine"("projectId");

-- CreateIndex
CREATE INDEX "ProjectBomLine_inventoryItemId_idx" ON "ProjectBomLine"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Jobcard_no_key" ON "Jobcard"("no");

-- CreateIndex
CREATE INDEX "Jobcard_status_idx" ON "Jobcard"("status");

-- CreateIndex
CREATE INDEX "Jobcard_projectId_idx" ON "Jobcard"("projectId");

-- CreateIndex
CREATE INDEX "Jobcard_siteId_idx" ON "Jobcard"("siteId");

-- CreateIndex
CREATE INDEX "JobcardOperation_status_idx" ON "JobcardOperation"("status");

-- CreateIndex
CREATE INDEX "JobcardOperation_equipmentId_idx" ON "JobcardOperation"("equipmentId");

-- CreateIndex
CREATE INDEX "JobcardOperation_assignedUserId_idx" ON "JobcardOperation"("assignedUserId");

-- CreateIndex
CREATE INDEX "JobcardOperation_dependencyId_idx" ON "JobcardOperation"("dependencyId");

-- CreateIndex
CREATE UNIQUE INDEX "JobcardOperation_jobcardId_sequence_key" ON "JobcardOperation"("jobcardId", "sequence");

-- CreateIndex
CREATE INDEX "JobcardWorker_userId_idx" ON "JobcardWorker"("userId");

-- CreateIndex
CREATE INDEX "HoursEntry_jobcardId_idx" ON "HoursEntry"("jobcardId");

-- CreateIndex
CREATE INDEX "HoursEntry_operationId_idx" ON "HoursEntry"("operationId");

-- CreateIndex
CREATE INDEX "HoursEntry_userId_idx" ON "HoursEntry"("userId");

-- CreateIndex
CREATE INDEX "HoursEntry_workDate_idx" ON "HoursEntry"("workDate");

-- CreateIndex
CREATE INDEX "JobcardInspectionLegacy_jobcardId_idx" ON "JobcardInspectionLegacy"("jobcardId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_code_key" ON "InventoryItem"("code");

-- CreateIndex
CREATE INDEX "InventoryItem_status_idx" ON "InventoryItem"("status");

-- CreateIndex
CREATE INDEX "InventoryItem_supplierId_idx" ON "InventoryItem"("supplierId");

-- CreateIndex
CREATE INDEX "InventoryLot_supplierId_idx" ON "InventoryLot"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_inventoryItemId_lotNumber_key" ON "InventoryLot"("inventoryItemId", "lotNumber");

-- CreateIndex
CREATE INDEX "StockMovement_inventoryItemId_idx" ON "StockMovement"("inventoryItemId");

-- CreateIndex
CREATE INDEX "StockMovement_action_idx" ON "StockMovement"("action");

-- CreateIndex
CREATE INDEX "StockMovement_projectId_idx" ON "StockMovement"("projectId");

-- CreateIndex
CREATE INDEX "StockMovement_jobcardId_idx" ON "StockMovement"("jobcardId");

-- CreateIndex
CREATE INDEX "StockMovement_userId_idx" ON "StockMovement"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Offcut_code_key" ON "Offcut"("code");

-- CreateIndex
CREATE INDEX "Offcut_status_idx" ON "Offcut"("status");

-- CreateIndex
CREATE INDEX "Offcut_inventoryItemId_idx" ON "Offcut"("inventoryItemId");

-- CreateIndex
CREATE INDEX "Offcut_sourceProjectId_idx" ON "Offcut"("sourceProjectId");

-- CreateIndex
CREATE INDEX "StockCount_inventoryItemId_idx" ON "StockCount"("inventoryItemId");

-- CreateIndex
CREATE INDEX "StockCount_userId_idx" ON "StockCount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BarcodeLink_barcode_key" ON "BarcodeLink"("barcode");

-- CreateIndex
CREATE INDEX "BarcodeLink_inventoryItemId_idx" ON "BarcodeLink"("inventoryItemId");

-- CreateIndex
CREATE INDEX "BarcodeLink_supplierId_idx" ON "BarcodeLink"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_no_key" ON "Supplier"("no");

-- CreateIndex
CREATE INDEX "Supplier_status_idx" ON "Supplier"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_no_key" ON "PurchaseOrder"("no");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_projectId_idx" ON "PurchaseOrder"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRfq_no_key" ON "PurchaseRfq"("no");

-- CreateIndex
CREATE INDEX "PurchaseRfq_status_idx" ON "PurchaseRfq"("status");

-- CreateIndex
CREATE INDEX "PurchaseRfq_supplierId_idx" ON "PurchaseRfq"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierInvoice_no_key" ON "SupplierInvoice"("no");

-- CreateIndex
CREATE INDEX "SupplierInvoice_status_idx" ON "SupplierInvoice"("status");

-- CreateIndex
CREATE INDEX "SupplierInvoice_supplierId_idx" ON "SupplierInvoice"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_purchaseOrderId_idx" ON "SupplierInvoice"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequisition_no_key" ON "PurchaseRequisition"("no");

-- CreateIndex
CREATE INDEX "PurchaseRequisition_status_idx" ON "PurchaseRequisition"("status");

-- CreateIndex
CREATE INDEX "PurchaseRequisition_projectId_idx" ON "PurchaseRequisition"("projectId");

-- CreateIndex
CREATE INDEX "PurchaseRequisition_requestedById_idx" ON "PurchaseRequisition"("requestedById");

-- CreateIndex
CREATE INDEX "PurchaseRequisition_approvedById_idx" ON "PurchaseRequisition"("approvedById");

-- CreateIndex
CREATE INDEX "PurchaseRequisitionLine_requisitionId_idx" ON "PurchaseRequisitionLine"("requisitionId");

-- CreateIndex
CREATE INDEX "PurchaseRequisitionLine_inventoryItemId_idx" ON "PurchaseRequisitionLine"("inventoryItemId");

-- CreateIndex
CREATE INDEX "PurchaseRequisitionLine_sourceBomLineId_idx" ON "PurchaseRequisitionLine"("sourceBomLineId");

-- CreateIndex
CREATE INDEX "PurchaseRequisitionLine_purchaseOrderId_idx" ON "PurchaseRequisitionLine"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_equipmentId_key" ON "Equipment"("equipmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Equipment_qrCode_key" ON "Equipment"("qrCode");

-- CreateIndex
CREATE INDEX "Equipment_status_idx" ON "Equipment"("status");

-- CreateIndex
CREATE INDEX "EquipmentInspection_equipmentId_idx" ON "EquipmentInspection"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentInspection_resolved_idx" ON "EquipmentInspection"("resolved");

-- CreateIndex
CREATE INDEX "EquipmentBreakdown_equipmentId_idx" ON "EquipmentBreakdown"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentBreakdown_resolved_idx" ON "EquipmentBreakdown"("resolved");

-- CreateIndex
CREATE INDEX "EquipmentBreakdown_resolvedById_idx" ON "EquipmentBreakdown"("resolvedById");

-- CreateIndex
CREATE INDEX "EquipmentPreUseCheck_equipmentId_idx" ON "EquipmentPreUseCheck"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentPreUseCheck_jobcardId_idx" ON "EquipmentPreUseCheck"("jobcardId");

-- CreateIndex
CREATE INDEX "EquipmentPreUseCheck_projectId_idx" ON "EquipmentPreUseCheck"("projectId");

-- CreateIndex
CREATE INDEX "EquipmentUsageSession_equipmentId_idx" ON "EquipmentUsageSession"("equipmentId");

-- CreateIndex
CREATE INDEX "EquipmentUsageSession_jobcardId_idx" ON "EquipmentUsageSession"("jobcardId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityInspection_no_key" ON "QualityInspection"("no");

-- CreateIndex
CREATE INDEX "QualityInspection_status_idx" ON "QualityInspection"("status");

-- CreateIndex
CREATE INDEX "QualityInspection_jobcardId_idx" ON "QualityInspection"("jobcardId");

-- CreateIndex
CREATE INDEX "QualityInspection_projectId_idx" ON "QualityInspection"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityWeld_no_key" ON "QualityWeld"("no");

-- CreateIndex
CREATE INDEX "QualityWeld_status_idx" ON "QualityWeld"("status");

-- CreateIndex
CREATE INDEX "QualityWeld_jobcardId_idx" ON "QualityWeld"("jobcardId");

-- CreateIndex
CREATE INDEX "QualityWeld_projectId_idx" ON "QualityWeld"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityNdt_no_key" ON "QualityNdt"("no");

-- CreateIndex
CREATE INDEX "QualityNdt_status_idx" ON "QualityNdt"("status");

-- CreateIndex
CREATE INDEX "QualityNdt_weldId_idx" ON "QualityNdt"("weldId");

-- CreateIndex
CREATE INDEX "QualityNdt_inspectionId_idx" ON "QualityNdt"("inspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityNcr_no_key" ON "QualityNcr"("no");

-- CreateIndex
CREATE INDEX "QualityNcr_status_idx" ON "QualityNcr"("status");

-- CreateIndex
CREATE INDEX "QualityNcr_severity_idx" ON "QualityNcr"("severity");

-- CreateIndex
CREATE INDEX "QualityNcr_projectId_idx" ON "QualityNcr"("projectId");

-- CreateIndex
CREATE INDEX "QualityNcr_jobcardId_idx" ON "QualityNcr"("jobcardId");

-- CreateIndex
CREATE INDEX "QualityNcr_supplierId_idx" ON "QualityNcr"("supplierId");

-- CreateIndex
CREATE INDEX "QualityNcr_customerId_idx" ON "QualityNcr"("customerId");

-- CreateIndex
CREATE INDEX "QualityNcr_capaId_idx" ON "QualityNcr"("capaId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityCapa_no_key" ON "QualityCapa"("no");

-- CreateIndex
CREATE INDEX "QualityCapa_status_idx" ON "QualityCapa"("status");

-- CreateIndex
CREATE UNIQUE INDEX "QualityHold_no_key" ON "QualityHold"("no");

-- CreateIndex
CREATE INDEX "QualityHold_status_idx" ON "QualityHold"("status");

-- CreateIndex
CREATE INDEX "QualityHold_scope_idx" ON "QualityHold"("scope");

-- CreateIndex
CREATE INDEX "QualityHold_projectId_idx" ON "QualityHold"("projectId");

-- CreateIndex
CREATE INDEX "QualityHold_jobcardId_idx" ON "QualityHold"("jobcardId");

-- CreateIndex
CREATE INDEX "QualityHold_ncrId_idx" ON "QualityHold"("ncrId");

-- CreateIndex
CREATE INDEX "QualityHold_appliedById_idx" ON "QualityHold"("appliedById");

-- CreateIndex
CREATE INDEX "QualityHold_releasedById_idx" ON "QualityHold"("releasedById");

-- CreateIndex
CREATE UNIQUE INDEX "QualityWps_no_key" ON "QualityWps"("no");

-- CreateIndex
CREATE INDEX "QualityWps_status_idx" ON "QualityWps"("status");

-- CreateIndex
CREATE INDEX "QualityWelderQual_expiryDate_idx" ON "QualityWelderQual"("expiryDate");

-- CreateIndex
CREATE INDEX "QualityWelderQual_welderId_idx" ON "QualityWelderQual"("welderId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityComplaint_no_key" ON "QualityComplaint"("no");

-- CreateIndex
CREATE INDEX "QualityComplaint_status_idx" ON "QualityComplaint"("status");

-- CreateIndex
CREATE INDEX "QualityComplaint_customerId_idx" ON "QualityComplaint"("customerId");

-- CreateIndex
CREATE INDEX "QualityComplaint_projectId_idx" ON "QualityComplaint"("projectId");

-- CreateIndex
CREATE INDEX "QualityComplaint_ncrId_idx" ON "QualityComplaint"("ncrId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityDossier_no_key" ON "QualityDossier"("no");

-- CreateIndex
CREATE INDEX "QualityDossier_projectId_idx" ON "QualityDossier"("projectId");

-- CreateIndex
CREATE INDEX "QualityDossierItem_dossierId_idx" ON "QualityDossierItem"("dossierId");

-- CreateIndex
CREATE UNIQUE INDEX "QualityItp_no_key" ON "QualityItp"("no");

-- CreateIndex
CREATE INDEX "QualityItp_projectId_idx" ON "QualityItp"("projectId");

-- CreateIndex
CREATE INDEX "QualityItpLine_status_idx" ON "QualityItpLine"("status");

-- CreateIndex
CREATE UNIQUE INDEX "QualityItpLine_itpId_sequence_key" ON "QualityItpLine"("itpId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "QualityRelease_no_key" ON "QualityRelease"("no");

-- CreateIndex
CREATE UNIQUE INDEX "QualityRelease_previousVersionId_key" ON "QualityRelease"("previousVersionId");

-- CreateIndex
CREATE INDEX "QualityRelease_result_idx" ON "QualityRelease"("result");

-- CreateIndex
CREATE INDEX "QualityRelease_projectId_idx" ON "QualityRelease"("projectId");

-- CreateIndex
CREATE INDEX "QualityRelease_jobcardId_idx" ON "QualityRelease"("jobcardId");

-- CreateIndex
CREATE INDEX "QualityRelease_decidedById_idx" ON "QualityRelease"("decidedById");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierQuality_supplierId_key" ON "SupplierQuality"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierQuality_approvalStatus_idx" ON "SupplierQuality"("approvalStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Document_previousVersionId_key" ON "Document"("previousVersionId");

-- CreateIndex
CREATE INDEX "Document_status_idx" ON "Document"("status");

-- CreateIndex
CREATE INDEX "Document_type_idx" ON "Document"("type");

-- CreateIndex
CREATE INDEX "Document_uploadedById_idx" ON "Document"("uploadedById");

-- CreateIndex
CREATE INDEX "DocumentFolder_projectId_idx" ON "DocumentFolder"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentFolder_name_projectId_key" ON "DocumentFolder"("name", "projectId");

-- CreateIndex
CREATE INDEX "DocumentCustomer_customerId_idx" ON "DocumentCustomer"("customerId");

-- CreateIndex
CREATE INDEX "DocumentSupplier_supplierId_idx" ON "DocumentSupplier"("supplierId");

-- CreateIndex
CREATE INDEX "DocumentProject_projectId_idx" ON "DocumentProject"("projectId");

-- CreateIndex
CREATE INDEX "DocumentJobcard_jobcardId_idx" ON "DocumentJobcard"("jobcardId");

-- CreateIndex
CREATE INDEX "DocumentEquipment_equipmentId_idx" ON "DocumentEquipment"("equipmentId");

-- CreateIndex
CREATE INDEX "DocumentPurchaseOrder_purchaseOrderId_idx" ON "DocumentPurchaseOrder"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "QualityInspectionDocument_qualityInspectionId_idx" ON "QualityInspectionDocument"("qualityInspectionId");

-- CreateIndex
CREATE INDEX "NcrDocument_ncrId_idx" ON "NcrDocument"("ncrId");

-- CreateIndex
CREATE INDEX "QualityHoldDocument_qualityHoldId_idx" ON "QualityHoldDocument"("qualityHoldId");

-- CreateIndex
CREATE INDEX "WpsDocument_qualityWpsId_idx" ON "WpsDocument"("qualityWpsId");

-- CreateIndex
CREATE INDEX "WelderQualificationDocument_qualityWelderQualId_idx" ON "WelderQualificationDocument"("qualityWelderQualId");

-- CreateIndex
CREATE INDEX "NdtRecordDocument_qualityNdtId_idx" ON "NdtRecordDocument"("qualityNdtId");

-- CreateIndex
CREATE INDEX "FinalReleaseDocument_qualityReleaseId_idx" ON "FinalReleaseDocument"("qualityReleaseId");

-- CreateIndex
CREATE INDEX "InventoryLotDocument_inventoryLotId_idx" ON "InventoryLotDocument"("inventoryLotId");

-- CreateIndex
CREATE INDEX "SavedReport_type_idx" ON "SavedReport"("type");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_occurredAt_idx" ON "AuditLog"("occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "SafetyEvent_kind_idx" ON "SafetyEvent"("kind");

-- CreateIndex
CREATE INDEX "SafetyEvent_equipmentId_idx" ON "SafetyEvent"("equipmentId");

-- CreateIndex
CREATE INDEX "SafetyEvent_qualityHoldId_idx" ON "SafetyEvent"("qualityHoldId");

-- CreateIndex
CREATE INDEX "SafetyEvent_qualityReleaseId_idx" ON "SafetyEvent"("qualityReleaseId");

-- CreateIndex
CREATE INDEX "SafetyEvent_previousDocumentId_idx" ON "SafetyEvent"("previousDocumentId");

-- CreateIndex
CREATE INDEX "SafetyEvent_newDocumentId_idx" ON "SafetyEvent"("newDocumentId");

-- CreateIndex
CREATE INDEX "SafetyEvent_occurredAt_idx" ON "SafetyEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "SafetyEvent_userId_idx" ON "SafetyEvent"("userId");

-- CreateIndex
CREATE INDEX "MigrationReconciliationRecord_resolution_idx" ON "MigrationReconciliationRecord"("resolution");

-- CreateIndex
CREATE INDEX "MigrationReconciliationRecord_sourceCollection_idx" ON "MigrationReconciliationRecord"("sourceCollection");

-- CreateIndex
CREATE INDEX "MigrationReconciliationRecord_resolvedById_idx" ON "MigrationReconciliationRecord"("resolvedById");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_homeSiteId_fkey" FOREIGN KEY ("homeSiteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupervisorSiteAssignment" ADD CONSTRAINT "SupervisorSiteAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupervisorSiteAssignment" ADD CONSTRAINT "SupervisorSiteAssignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupervisorTeamAssignment" ADD CONSTRAINT "SupervisorTeamAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupervisorTeamAssignment" ADD CONSTRAINT "SupervisorTeamAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupervisorProjectAssignment" ADD CONSTRAINT "SupervisorProjectAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupervisorProjectAssignment" ADD CONSTRAINT "SupervisorProjectAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupervisorJobcardAssignment" ADD CONSTRAINT "SupervisorJobcardAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupervisorJobcardAssignment" ADD CONSTRAINT "SupervisorJobcardAssignment_jobcardId_fkey" FOREIGN KEY ("jobcardId") REFERENCES "Jobcard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerContact" ADD CONSTRAINT "CustomerContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingLead" ADD CONSTRAINT "MarketingLead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingLead" ADD CONSTRAINT "MarketingLead_linkedOpportunityId_fkey" FOREIGN KEY ("linkedOpportunityId") REFERENCES "MarketingOpportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingOpportunity" ADD CONSTRAINT "MarketingOpportunity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingOpportunity" ADD CONSTRAINT "MarketingOpportunity_estimationId_fkey" FOREIGN KEY ("estimationId") REFERENCES "Estimation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimation" ADD CONSTRAINT "Estimation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimation" ADD CONSTRAINT "Estimation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimationLine" ADD CONSTRAINT "EstimationLine_estimationId_fkey" FOREIGN KEY ("estimationId") REFERENCES "Estimation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBomLine" ADD CONSTRAINT "ProjectBomLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBomLine" ADD CONSTRAINT "ProjectBomLine_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jobcard" ADD CONSTRAINT "Jobcard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jobcard" ADD CONSTRAINT "Jobcard_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobcardOperation" ADD CONSTRAINT "JobcardOperation_jobcardId_fkey" FOREIGN KEY ("jobcardId") REFERENCES "Jobcard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobcardOperation" ADD CONSTRAINT "JobcardOperation_dependencyId_fkey" FOREIGN KEY ("dependencyId") REFERENCES "JobcardOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobcardOperation" ADD CONSTRAINT "JobcardOperation_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobcardOperation" ADD CONSTRAINT "JobcardOperation_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobcardWorker" ADD CONSTRAINT "JobcardWorker_jobcardId_fkey" FOREIGN KEY ("jobcardId") REFERENCES "Jobcard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobcardWorker" ADD CONSTRAINT "JobcardWorker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoursEntry" ADD CONSTRAINT "HoursEntry_jobcardId_fkey" FOREIGN KEY ("jobcardId") REFERENCES "Jobcard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoursEntry" ADD CONSTRAINT "HoursEntry_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "JobcardOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HoursEntry" ADD CONSTRAINT "HoursEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobcardInspectionLegacy" ADD CONSTRAINT "JobcardInspectionLegacy_jobcardId_fkey" FOREIGN KEY ("jobcardId") REFERENCES "Jobcard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_jobcardId_fkey" FOREIGN KEY ("jobcardId") REFERENCES "Jobcard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offcut" ADD CONSTRAINT "Offcut_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offcut" ADD CONSTRAINT "Offcut_sourceProjectId_fkey" FOREIGN KEY ("sourceProjectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarcodeLink" ADD CONSTRAINT "BarcodeLink_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarcodeLink" ADD CONSTRAINT "BarcodeLink_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRfq" ADD CONSTRAINT "PurchaseRfq_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisitionLine" ADD CONSTRAINT "PurchaseRequisitionLine_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "PurchaseRequisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisitionLine" ADD CONSTRAINT "PurchaseRequisitionLine_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisitionLine" ADD CONSTRAINT "PurchaseRequisitionLine_sourceBomLineId_fkey" FOREIGN KEY ("sourceBomLineId") REFERENCES "ProjectBomLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequisitionLine" ADD CONSTRAINT "PurchaseRequisitionLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentInspection" ADD CONSTRAINT "EquipmentInspection_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentBreakdown" ADD CONSTRAINT "EquipmentBreakdown_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentBreakdown" ADD CONSTRAINT "EquipmentBreakdown_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentPreUseCheck" ADD CONSTRAINT "EquipmentPreUseCheck_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentPreUseCheck" ADD CONSTRAINT "EquipmentPreUseCheck_jobcardId_fkey" FOREIGN KEY ("jobcardId") REFERENCES "Jobcard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentPreUseCheck" ADD CONSTRAINT "EquipmentPreUseCheck_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageSession" ADD CONSTRAINT "EquipmentUsageSession_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EquipmentUsageSession" ADD CONSTRAINT "EquipmentUsageSession_jobcardId_fkey" FOREIGN KEY ("jobcardId") REFERENCES "Jobcard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityInspection" ADD CONSTRAINT "QualityInspection_jobcardId_fkey" FOREIGN KEY ("jobcardId") REFERENCES "Jobcard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityInspection" ADD CONSTRAINT "QualityInspection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityWeld" ADD CONSTRAINT "QualityWeld_jobcardId_fkey" FOREIGN KEY ("jobcardId") REFERENCES "Jobcard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityWeld" ADD CONSTRAINT "QualityWeld_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityNdt" ADD CONSTRAINT "QualityNdt_weldId_fkey" FOREIGN KEY ("weldId") REFERENCES "QualityWeld"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityNdt" ADD CONSTRAINT "QualityNdt_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "QualityInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityNcr" ADD CONSTRAINT "QualityNcr_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityNcr" ADD CONSTRAINT "QualityNcr_jobcardId_fkey" FOREIGN KEY ("jobcardId") REFERENCES "Jobcard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityNcr" ADD CONSTRAINT "QualityNcr_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityNcr" ADD CONSTRAINT "QualityNcr_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityNcr" ADD CONSTRAINT "QualityNcr_capaId_fkey" FOREIGN KEY ("capaId") REFERENCES "QualityCapa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityHold" ADD CONSTRAINT "QualityHold_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityHold" ADD CONSTRAINT "QualityHold_jobcardId_fkey" FOREIGN KEY ("jobcardId") REFERENCES "Jobcard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityHold" ADD CONSTRAINT "QualityHold_ncrId_fkey" FOREIGN KEY ("ncrId") REFERENCES "QualityNcr"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityHold" ADD CONSTRAINT "QualityHold_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityHold" ADD CONSTRAINT "QualityHold_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityWelderQual" ADD CONSTRAINT "QualityWelderQual_welderId_fkey" FOREIGN KEY ("welderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityComplaint" ADD CONSTRAINT "QualityComplaint_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityComplaint" ADD CONSTRAINT "QualityComplaint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityComplaint" ADD CONSTRAINT "QualityComplaint_ncrId_fkey" FOREIGN KEY ("ncrId") REFERENCES "QualityNcr"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityDossier" ADD CONSTRAINT "QualityDossier_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityDossierItem" ADD CONSTRAINT "QualityDossierItem_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "QualityDossier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityItp" ADD CONSTRAINT "QualityItp_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityItpLine" ADD CONSTRAINT "QualityItpLine_itpId_fkey" FOREIGN KEY ("itpId") REFERENCES "QualityItp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityRelease" ADD CONSTRAINT "QualityRelease_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityRelease" ADD CONSTRAINT "QualityRelease_jobcardId_fkey" FOREIGN KEY ("jobcardId") REFERENCES "Jobcard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityRelease" ADD CONSTRAINT "QualityRelease_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityRelease" ADD CONSTRAINT "QualityRelease_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "QualityRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierQuality" ADD CONSTRAINT "SupplierQuality_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentFolder" ADD CONSTRAINT "DocumentFolder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentCustomer" ADD CONSTRAINT "DocumentCustomer_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentCustomer" ADD CONSTRAINT "DocumentCustomer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSupplier" ADD CONSTRAINT "DocumentSupplier_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSupplier" ADD CONSTRAINT "DocumentSupplier_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentProject" ADD CONSTRAINT "DocumentProject_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentProject" ADD CONSTRAINT "DocumentProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentJobcard" ADD CONSTRAINT "DocumentJobcard_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentJobcard" ADD CONSTRAINT "DocumentJobcard_jobcardId_fkey" FOREIGN KEY ("jobcardId") REFERENCES "Jobcard"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEquipment" ADD CONSTRAINT "DocumentEquipment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEquipment" ADD CONSTRAINT "DocumentEquipment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPurchaseOrder" ADD CONSTRAINT "DocumentPurchaseOrder_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPurchaseOrder" ADD CONSTRAINT "DocumentPurchaseOrder_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityInspectionDocument" ADD CONSTRAINT "QualityInspectionDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityInspectionDocument" ADD CONSTRAINT "QualityInspectionDocument_qualityInspectionId_fkey" FOREIGN KEY ("qualityInspectionId") REFERENCES "QualityInspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NcrDocument" ADD CONSTRAINT "NcrDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NcrDocument" ADD CONSTRAINT "NcrDocument_ncrId_fkey" FOREIGN KEY ("ncrId") REFERENCES "QualityNcr"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityHoldDocument" ADD CONSTRAINT "QualityHoldDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualityHoldDocument" ADD CONSTRAINT "QualityHoldDocument_qualityHoldId_fkey" FOREIGN KEY ("qualityHoldId") REFERENCES "QualityHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WpsDocument" ADD CONSTRAINT "WpsDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WpsDocument" ADD CONSTRAINT "WpsDocument_qualityWpsId_fkey" FOREIGN KEY ("qualityWpsId") REFERENCES "QualityWps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WelderQualificationDocument" ADD CONSTRAINT "WelderQualificationDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WelderQualificationDocument" ADD CONSTRAINT "WelderQualificationDocument_qualityWelderQualId_fkey" FOREIGN KEY ("qualityWelderQualId") REFERENCES "QualityWelderQual"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NdtRecordDocument" ADD CONSTRAINT "NdtRecordDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NdtRecordDocument" ADD CONSTRAINT "NdtRecordDocument_qualityNdtId_fkey" FOREIGN KEY ("qualityNdtId") REFERENCES "QualityNdt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalReleaseDocument" ADD CONSTRAINT "FinalReleaseDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinalReleaseDocument" ADD CONSTRAINT "FinalReleaseDocument_qualityReleaseId_fkey" FOREIGN KEY ("qualityReleaseId") REFERENCES "QualityRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLotDocument" ADD CONSTRAINT "InventoryLotDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLotDocument" ADD CONSTRAINT "InventoryLotDocument_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_qualityHoldId_fkey" FOREIGN KEY ("qualityHoldId") REFERENCES "QualityHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_qualityReleaseId_fkey" FOREIGN KEY ("qualityReleaseId") REFERENCES "QualityRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_previousDocumentId_fkey" FOREIGN KEY ("previousDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_newDocumentId_fkey" FOREIGN KEY ("newDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationReconciliationRecord" ADD CONSTRAINT "MigrationReconciliationRecord_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 0A-R1 final integrity-pass manual additions (not generated by Prisma).
-- Prisma's schema language has no @@check attribute (confirmed against 7.10.0)
-- and no way to express a functional/partial unique index or a trigger, so
-- every constraint below is hand-written directly against the tables Prisma
-- just created.
--
-- IMPORTANT Postgres CHECK-constraint note followed throughout: a CHECK whose
-- expression evaluates to NULL is treated as SATISFIED, not failed. Every
-- conditional "required when X" check below therefore uses an explicit
-- "col IS NOT NULL AND ..." guard rather than relying on e.g. btrim(NULL) to
-- naturally fail — btrim(NULL) is NULL, and NULL > 0 is NULL, which would
-- silently PASS the constraint instead of rejecting it.
--
-- IMPORTANT JSONB note: PostgreSQL NOT NULL accepts the JSONB value `null`
-- (the JSON literal, stored as a real, non-SQL-NULL value) — a NOT NULL Json
-- column can still hold "no evidence at all". `jsonb_typeof(col)` returns the
-- *string* 'null' for that value (never SQL NULL, and never 'object'/'array'),
-- so `jsonb_typeof(col) = 'object'` / `= 'array'` rejects JSON null and any
-- wrong type in the same check.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── SafetyEvent ───────────────────────────────────────────────────────────
-- Exactly one typed safety target per event, matching its kind. DOCUMENT_SUPERSEDED identifies
-- the two actual Document versions directly (previousDocumentId/newDocumentId), not via
-- QualityHold/QualityRelease alone.
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_exactly_one_target" CHECK (
  (
    "kind" IN ('EQUIPMENT_BLOCK', 'EQUIPMENT_PASS')
    AND "equipmentId" IS NOT NULL
    AND "qualityHoldId" IS NULL AND "qualityReleaseId" IS NULL
    AND "previousDocumentId" IS NULL AND "newDocumentId" IS NULL
  ) OR (
    "kind" IN ('HOLD_APPLY', 'HOLD_RELEASE')
    AND "qualityHoldId" IS NOT NULL
    AND "equipmentId" IS NULL AND "qualityReleaseId" IS NULL
    AND "previousDocumentId" IS NULL AND "newDocumentId" IS NULL
  ) OR (
    "kind" IN ('RELEASE_GRANT', 'RELEASE_REJECT')
    AND "qualityReleaseId" IS NOT NULL
    AND "equipmentId" IS NULL AND "qualityHoldId" IS NULL
    AND "previousDocumentId" IS NULL AND "newDocumentId" IS NULL
  ) OR (
    "kind" = 'DOCUMENT_SUPERSEDED'
    AND "previousDocumentId" IS NOT NULL AND "newDocumentId" IS NOT NULL
    AND "previousDocumentId" <> "newDocumentId"
    AND "equipmentId" IS NULL AND "qualityHoldId" IS NULL AND "qualityReleaseId" IS NULL
  )
);

-- No anonymous safety action: a real User actor (actorType = USER, userId set) or an explicit
-- SYSTEM actor (actorType = SYSTEM, userId NULL) — never a silently-nullable "unknown".
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_actor_consistency" CHECK (
  ("actorType" = 'USER' AND "userId" IS NOT NULL) OR
  ("actorType" = 'SYSTEM' AND "userId" IS NULL)
);

-- gateVersion must not be blank (an oversight in the prior pass — QualityRelease had this,
-- SafetyEvent did not).
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_gateVersion_normalized" CHECK (length(btrim("gateVersion")) > 0);

-- reasons must be a real JSON array (an empty array is valid; JSON null or any other type is
-- not); decisionSnapshot must be a real, non-null JSON object.
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_reasons_is_array" CHECK (jsonb_typeof("reasons") = 'array');
ALTER TABLE "SafetyEvent" ADD CONSTRAINT "SafetyEvent_decisionSnapshot_is_object" CHECK (jsonb_typeof("decisionSnapshot") = 'object');

-- SafetyEvent must be append-only at the PostgreSQL permission level where practical
-- (Decisions 7/8/9). Known limitation (see backend/README.md): the ideal enforcement is a
-- dedicated low-privilege application database role with INSERT/SELECT-only grants; no such
-- role exists yet in this environment, so this trigger is the enforcement mechanism until one is
-- provisioned.
CREATE OR REPLACE FUNCTION safety_event_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'SafetyEvent records are append-only and cannot be updated or deleted (id=%)', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER safety_event_no_update
  BEFORE UPDATE ON "SafetyEvent"
  FOR EACH ROW
  EXECUTE FUNCTION safety_event_append_only();

CREATE TRIGGER safety_event_no_delete
  BEFORE DELETE ON "SafetyEvent"
  FOR EACH ROW
  EXECUTE FUNCTION safety_event_append_only();

-- Document-supersession verification: the exactly-one-target CHECK above only proves
-- previousDocumentId/newDocumentId are two different, real Document rows — it cannot prove the
-- new document actually supersedes the stated previous one, since that requires looking up
-- another row, which a CHECK constraint cannot do. This BEFORE INSERT trigger closes that gap:
-- for a DOCUMENT_SUPERSEDED event, newDocument.previousVersionId must equal the event's own
-- previousDocumentId, or the insert is rejected. (BEFORE INSERT only: SafetyEvent has no UPDATE
-- path to worry about — it is append-only, enforced by the triggers above.)
CREATE OR REPLACE FUNCTION safety_event_document_supersession_check()
RETURNS TRIGGER AS $$
DECLARE
  actual_previous_version_id UUID;
BEGIN
  IF NEW."kind" = 'DOCUMENT_SUPERSEDED' THEN
    SELECT "previousVersionId" INTO actual_previous_version_id
    FROM "Document"
    WHERE "id" = NEW."newDocumentId";

    IF actual_previous_version_id IS DISTINCT FROM NEW."previousDocumentId" THEN
      RAISE EXCEPTION 'DOCUMENT_SUPERSEDED event does not match the real Document version chain: newDocument.previousVersionId (%) does not equal the event previousDocumentId (%)',
        actual_previous_version_id, NEW."previousDocumentId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER safety_event_document_supersession_check
  BEFORE INSERT ON "SafetyEvent"
  FOR EACH ROW
  EXECUTE FUNCTION safety_event_document_supersession_check();

-- ── QualityRelease ────────────────────────────────────────────────────────
-- Final Release evidence is immutable: insert-only at the database level, identical mechanism
-- and identical known limitation to SafetyEvent above.
CREATE OR REPLACE FUNCTION quality_release_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'QualityRelease records are immutable and cannot be updated or deleted (id=%)', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quality_release_no_update
  BEFORE UPDATE ON "QualityRelease"
  FOR EACH ROW
  EXECUTE FUNCTION quality_release_append_only();

CREATE TRIGGER quality_release_no_delete
  BEFORE DELETE ON "QualityRelease"
  FOR EACH ROW
  EXECUTE FUNCTION quality_release_append_only();

-- A release cannot supersede itself. One-hop case only; full multi-hop cycle prevention is
-- deferred to application-level validation and tests, per the contract's own wording — identical
-- reasoning to Document.previousVersionId.
ALTER TABLE "QualityRelease"
  ADD CONSTRAINT "QualityRelease_previousVersionId_not_self"
  CHECK ("previousVersionId" IS NULL OR "previousVersionId" <> "id");

-- Every decision — RELEASED and RELEASED_WITH_CONDITIONS included, not just NOT_RELEASED —
-- carries real actor attribution: a USER decision requires decidedById; a SYSTEM decision
-- forbids it.
ALTER TABLE "QualityRelease" ADD CONSTRAINT "QualityRelease_actor_consistency" CHECK (
  ("decisionActorType" = 'USER' AND "decidedById" IS NOT NULL) OR
  ("decisionActorType" = 'SYSTEM' AND "decidedById" IS NULL)
);

-- gateVersion must not be blank (decidedAt is a plain NOT NULL column — see schema.prisma — so
-- no separate CHECK is needed for "a decision cannot exist without deciding when").
ALTER TABLE "QualityRelease" ADD CONSTRAINT "QualityRelease_gateVersion_normalized" CHECK (length(btrim("gateVersion")) > 0);

-- gateResultSnapshot must be a real, non-null JSON object; blockingReasons must be a real JSON
-- array (an empty array is valid; JSON null or any other type is not).
ALTER TABLE "QualityRelease" ADD CONSTRAINT "QualityRelease_gateResultSnapshot_is_object" CHECK (jsonb_typeof("gateResultSnapshot") = 'object');
ALTER TABLE "QualityRelease" ADD CONSTRAINT "QualityRelease_blockingReasons_is_array" CHECK (jsonb_typeof("blockingReasons") = 'array');

-- Supersession-context verification: a new release's previousVersionId must point at a release
-- in the *same* project and jobcard context — otherwise a release could be superseded across
-- Project or Jobcard boundaries, silently changing what safety evidence a given project/jobcard's
-- history appears to show. This requires a cross-row lookup a plain CHECK cannot perform, hence a
-- BEFORE INSERT trigger (QualityRelease is insert-only, so INSERT is the only path that matters).
-- jobcardId is nullable on both sides, so the comparison uses IS NOT DISTINCT FROM semantics
-- (NULL = NULL counts as a match) via IS DISTINCT FROM in the rejection condition.
CREATE OR REPLACE FUNCTION quality_release_supersession_context_check()
RETURNS TRIGGER AS $$
DECLARE
  prev_project_id UUID;
  prev_jobcard_id UUID;
BEGIN
  IF NEW."previousVersionId" IS NOT NULL THEN
    SELECT "projectId", "jobcardId" INTO prev_project_id, prev_jobcard_id
    FROM "QualityRelease"
    WHERE "id" = NEW."previousVersionId";

    IF prev_project_id IS DISTINCT FROM NEW."projectId" OR prev_jobcard_id IS DISTINCT FROM NEW."jobcardId" THEN
      RAISE EXCEPTION 'QualityRelease supersession must stay within the same project and jobcard context (previous: project=%, jobcard=%; new: project=%, jobcard=%)',
        prev_project_id, prev_jobcard_id, NEW."projectId", NEW."jobcardId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quality_release_supersession_context_check
  BEFORE INSERT ON "QualityRelease"
  FOR EACH ROW
  EXECUTE FUNCTION quality_release_supersession_context_check();

-- ── QualityHold ───────────────────────────────────────────────────────────
-- Target-scope integrity: PROJECT scope requires projectId and forbids jobcardId; JOBCARD scope
-- requires jobcardId and forbids projectId. A hold can never exist without a valid target.
ALTER TABLE "QualityHold" ADD CONSTRAINT "QualityHold_valid_target" CHECK (
  ("scope" = 'PROJECT' AND "projectId" IS NOT NULL AND "jobcardId" IS NULL) OR
  ("scope" = 'JOBCARD' AND "jobcardId" IS NOT NULL AND "projectId" IS NULL)
);

-- Apply-actor consistency: a USER apply requires appliedById; a SYSTEM apply forbids it.
ALTER TABLE "QualityHold" ADD CONSTRAINT "QualityHold_applied_actor_consistency" CHECK (
  ("appliedActorType" = 'USER' AND "appliedById" IS NOT NULL) OR
  ("appliedActorType" = 'SYSTEM' AND "appliedById" IS NULL)
);

-- Release-fact/status consistency, both directions at once — this is what makes it impossible
-- to (a) insert a row directly as RELEASED with incomplete release facts, and (b) populate any
-- release field while status is still ACTIVE: an ACTIVE row must have every release field NULL;
-- a RELEASED row must have every release field populated and internally consistent (actor type
-- set, actor-vs-id consistent, releasedAt set, reason and evidence both non-blank). Explicit
-- "IS NOT NULL AND length(btrim(...)) > 0" (not just the length check alone) because a CHECK
-- expression that evaluates to NULL is treated as satisfied, not failed, in Postgres — a NULL
-- releaseReason must make this branch evaluate to FALSE, not NULL.
ALTER TABLE "QualityHold" ADD CONSTRAINT "QualityHold_release_fields_consistency" CHECK (
  (
    "status" = 'ACTIVE'
    AND "releasedActorType" IS NULL AND "releasedById" IS NULL
    AND "releasedAt" IS NULL AND "releaseReason" IS NULL AND "releaseEvidenceRef" IS NULL
  ) OR (
    "status" = 'RELEASED'
    AND "releasedActorType" IS NOT NULL
    AND "releasedAt" IS NOT NULL
    AND "releaseReason" IS NOT NULL AND length(btrim("releaseReason")) > 0
    AND "releaseEvidenceRef" IS NOT NULL AND length(btrim("releaseEvidenceRef")) > 0
    AND (
      ("releasedActorType" = 'USER' AND "releasedById" IS NOT NULL) OR
      ("releasedActorType" = 'SYSTEM' AND "releasedById" IS NULL)
    )
  )
);

-- Full identity and lifecycle immutability (Phase 0A-R1 final integrity pass — supersedes the
-- narrower "lock only the release fact" trigger from the prior pass). Two rules:
--   1. Once status is RELEASED, the row is fully locked: every UPDATE is rejected, full stop —
--      the same terminal immutability as SafetyEvent/QualityRelease/AuditLog.
--   2. While ACTIVE, nine columns can never change under any circumstance, regardless of what
--      else is being updated: no, scope, projectId, jobcardId, ncrId, appliedActorType,
--      appliedById, appliedAt, createdAt. (updatedAt/version remain free to change — they are
--      technical bookkeeping, not safety state. The ACTIVE -> RELEASED transition itself, and
--      what it may set, is governed entirely by QualityHold_release_fields_consistency above;
--      this trigger only ever guards the nine identity/apply columns.)
-- Together: an existing hold can never be retargeted to a different Project/Jobcard/NCR, nor
-- have its applying actor changed, nor be edited at all once released.
CREATE OR REPLACE FUNCTION quality_hold_immutability()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'RELEASED' THEN
    RAISE EXCEPTION 'QualityHold is immutable once RELEASED (id=%)', OLD.id;
  END IF;

  IF NEW."no" IS DISTINCT FROM OLD."no" OR
     NEW."scope" IS DISTINCT FROM OLD."scope" OR
     NEW."projectId" IS DISTINCT FROM OLD."projectId" OR
     NEW."jobcardId" IS DISTINCT FROM OLD."jobcardId" OR
     NEW."ncrId" IS DISTINCT FROM OLD."ncrId" OR
     NEW."appliedActorType" IS DISTINCT FROM OLD."appliedActorType" OR
     NEW."appliedById" IS DISTINCT FROM OLD."appliedById" OR
     NEW."appliedAt" IS DISTINCT FROM OLD."appliedAt" OR
     NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'QualityHold identity and apply facts cannot change after creation (id=%)', OLD.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quality_hold_immutability
  BEFORE UPDATE ON "QualityHold"
  FOR EACH ROW
  EXECUTE FUNCTION quality_hold_immutability();

-- ── AuditLog ─────────────────────────────────────────────────────────────
-- AuditLog must not support UPDATE or DELETE through the application database role either.
-- Same trigger pattern and same known limitation as SafetyEvent (see backend/README.md):
-- corrections must be new AuditLog rows, never mutations of existing audit evidence.
CREATE OR REPLACE FUNCTION audit_log_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog records are append-only and cannot be updated or deleted (id=%)', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_append_only();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_append_only();

-- ── TeamMembership / Document / User (carried over unchanged) ────────────
CREATE UNIQUE INDEX "TeamMembership_userId_teamId_active_key"
  ON "TeamMembership" ("userId", "teamId")
  WHERE "active" = true;

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_previousVersionId_not_self"
  CHECK ("previousVersionId" IS NULL OR "previousVersionId" <> "id");

CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (LOWER("email"));

-- ── Numeric range, date-order (carried over unchanged) ────────────────────
ALTER TABLE "EstimationLine" ADD CONSTRAINT "EstimationLine_discountPct_range" CHECK ("discountPct" >= 0 AND "discountPct" <= 100);
ALTER TABLE "EstimationLine" ADD CONSTRAINT "EstimationLine_taxPct_range" CHECK ("taxPct" >= 0 AND "taxPct" <= 100);
ALTER TABLE "EstimationLine" ADD CONSTRAINT "EstimationLine_wastePct_range" CHECK ("wastePct" >= 0 AND "wastePct" <= 100);
ALTER TABLE "MarketingOpportunity" ADD CONSTRAINT "MarketingOpportunity_probability_range" CHECK ("probability" IS NULL OR ("probability" >= 0 AND "probability" <= 100));

ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_stock_nonneg" CHECK ("stock" >= 0);
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_reserved_nonneg" CHECK ("reserved" >= 0);
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_minStock_nonneg" CHECK ("minStock" >= 0);
ALTER TABLE "ProjectBomLine" ADD CONSTRAINT "ProjectBomLine_required_nonneg" CHECK ("required" >= 0);
ALTER TABLE "ProjectBomLine" ADD CONSTRAINT "ProjectBomLine_reserved_nonneg" CHECK ("reserved" >= 0);
ALTER TABLE "ProjectBomLine" ADD CONSTRAINT "ProjectBomLine_issued_nonneg" CHECK ("issued" >= 0);
ALTER TABLE "Project" ADD CONSTRAINT "Project_plannedHours_nonneg" CHECK ("plannedHours" >= 0);
ALTER TABLE "Project" ADD CONSTRAINT "Project_usedHours_nonneg" CHECK ("usedHours" >= 0);
ALTER TABLE "JobcardOperation" ADD CONSTRAINT "JobcardOperation_plannedHours_nonneg" CHECK ("plannedHours" >= 0);
ALTER TABLE "JobcardOperation" ADD CONSTRAINT "JobcardOperation_loggedHours_nonneg" CHECK ("loggedHours" >= 0);
ALTER TABLE "HoursEntry" ADD CONSTRAINT "HoursEntry_hours_nonneg" CHECK ("hours" >= 0);
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_qty_nonneg" CHECK ("qty" >= 0);
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_counted_nonneg" CHECK ("counted" >= 0);
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_systemQty_nonneg" CHECK ("systemQty" >= 0);
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_receivedQty_nonneg" CHECK ("receivedQty" >= 0);
ALTER TABLE "PurchaseRequisitionLine" ADD CONSTRAINT "PurchaseRequisitionLine_qtyRequested_nonneg" CHECK ("qtyRequested" >= 0);
ALTER TABLE "EstimationLine" ADD CONSTRAINT "EstimationLine_qty_nonneg" CHECK ("qty" >= 0);
ALTER TABLE "EquipmentUsageSession" ADD CONSTRAINT "EquipmentUsageSession_hours_nonneg" CHECK ("hours" >= 0);
ALTER TABLE "EquipmentUsageSession" ADD CONSTRAINT "EquipmentUsageSession_meterBefore_nonneg" CHECK ("meterBefore" IS NULL OR "meterBefore" >= 0);
ALTER TABLE "EquipmentUsageSession" ADD CONSTRAINT "EquipmentUsageSession_meterAfter_nonneg" CHECK ("meterAfter" IS NULL OR "meterAfter" >= 0);

ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_validTo_after_validFrom" CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");

ALTER TABLE "EquipmentUsageSession" ADD CONSTRAINT "EquipmentUsageSession_meterAfter_gte_meterBefore" CHECK ("meterBefore" IS NULL OR "meterAfter" IS NULL OR "meterAfter" >= "meterBefore");

-- ── Normalized (non-empty, non-whitespace-only) business codes (carried over unchanged) ──
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "Estimation" ADD CONSTRAINT "Estimation_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "Project" ADD CONSTRAINT "Project_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "Jobcard" ADD CONSTRAINT "Jobcard_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_code_normalized" CHECK (length(btrim("code")) > 0);
ALTER TABLE "Offcut" ADD CONSTRAINT "Offcut_code_normalized" CHECK (length(btrim("code")) > 0);
ALTER TABLE "BarcodeLink" ADD CONSTRAINT "BarcodeLink_barcode_normalized" CHECK (length(btrim("barcode")) > 0);
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "PurchaseRfq" ADD CONSTRAINT "PurchaseRfq_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "PurchaseRequisition" ADD CONSTRAINT "PurchaseRequisition_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_equipmentId_normalized" CHECK (length(btrim("equipmentId")) > 0);
ALTER TABLE "QualityInspection" ADD CONSTRAINT "QualityInspection_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "QualityWeld" ADD CONSTRAINT "QualityWeld_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "QualityNdt" ADD CONSTRAINT "QualityNdt_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "QualityNcr" ADD CONSTRAINT "QualityNcr_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "QualityCapa" ADD CONSTRAINT "QualityCapa_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "QualityHold" ADD CONSTRAINT "QualityHold_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "QualityWps" ADD CONSTRAINT "QualityWps_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "QualityComplaint" ADD CONSTRAINT "QualityComplaint_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "QualityDossier" ADD CONSTRAINT "QualityDossier_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "QualityItp" ADD CONSTRAINT "QualityItp_no_normalized" CHECK (length(btrim("no")) > 0);
ALTER TABLE "QualityRelease" ADD CONSTRAINT "QualityRelease_no_normalized" CHECK (length(btrim("no")) > 0);
