Map the core business logic flows in the RoE platform.

Produce `docs/analysis/technical/business-logic-map.md` covering:

1. **Order Lifecycle**: Trace an order from creation to fulfillment. What statuses exist? What triggers transitions? Which modules are involved?
2. **Garment Configuration**: How are garments defined? Measurements, styles, fabrics, customisations. What models and relationships are involved?
3. **Fabric Management**: How are fabrics tracked? Calculation logic for fabric quantities per garment. Mill/supplier ordering flow.
4. **Measurement System**: How are client measurements captured, stored, and applied to orders?
5. **Payment Flow**: Invoice creation, payment processing, refunds, partial payments. Which payment providers and when.
6. **Client Communication**: How are notifications sent? Appointment scheduling. Status updates.
7. **Commission & Partner Logic**: How commissions are calculated and attributed to partners.

Read CLAUDE.md first for project context. Focus on Actions, Services, and Jobs in the API modules. This is critical for understanding the domain.
