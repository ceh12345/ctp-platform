# CTP Client Data Requirements

What we need from you to build a working demo with YOUR data. Most of this already exists in your ERP, MES, or spreadsheets — we just need it exported in any format (Excel, CSV, JSON, PDF).

---

## 1. Resources — "What do you have?"

We need a list of every resource that gets scheduled. Think of anything that can only be in one place or do one thing at a time.

**Equipment / Machines / Rooms**
- Name and ID for each piece of equipment
- Type or group (e.g., "CNC Machine", "Reactor", "Operating Room", "Diamond Field")
- Capacity — can it run 1 job at a time or multiple? (e.g., an oven with 4 racks, a recovery ward with 6 beds)
- Any equipment that is interchangeable? (e.g., CNC-01 and CNC-02 can both run the same jobs)

**People**
- Names and roles (operators, surgeons, technicians, inspectors, umpires)
- What is each person qualified to do? (e.g., "Patel can run the press and coater but not the reactor")
- Are some people interchangeable for certain tasks?

**Other constrained resources**
- Tooling, fixtures, jigs that are shared across jobs
- Rooms, bays, cleanrooms, labs
- Vehicles, cranes, forklifts
- Anything else that's limited and gets fought over

**For each resource, we need:**
- [ ] Name / ID
- [ ] Type or group
- [ ] Capacity (1 unless it's pooled)
- [ ] Interchangeable alternatives (if any)
- [ ] Qualifications or capabilities (what can it do?)

---

## 2. Availability — "When are they available?"

**Shift schedules**
- What are the shift patterns? (e.g., Day 6:00-14:00, Swing 14:00-22:00, Night 22:00-6:00)
- Which resources work which shifts?
- Any resources that run 24/7? (e.g., ovens, reactors that don't need an operator)
- Weekend availability?

**Calendars**
- Holidays or planned shutdowns in the planning window
- Scheduled maintenance windows (e.g., "CNC-01 is down every Wednesday morning for maintenance")
- Seasonal patterns (e.g., "grass fields closed November through March")

**For each resource, we need:**
- [ ] Working hours / shift pattern
- [ ] Days of the week available
- [ ] Known downtime or maintenance windows
- [ ] Overtime availability (if applicable)

---

## 3. Products / Work Orders — "What are you making?"

**Current workload**
- A list of active orders / jobs / cases / games currently in the pipeline
- For each: name, quantity (if applicable), priority, due date or need-by date
- Status: not started, in progress, partially complete

**Routings / Process Plans**
- For each product or job type, what are the steps? (e.g., Setup → Mill → Drill → QC → Package)
- For each step: 
  - How long does it take?
  - What equipment / resources does it need?
  - Can multiple resources do it? (e.g., "milling can run on CNC-01, CNC-02, or CNC-03")
  - Does it need multiple resources at the same time? (e.g., "surgery needs an OR + surgeon + anesthesiologist + nurse")
  - Must it happen immediately after the previous step, or can there be a gap?

**For each product / order type, we need:**
- [ ] Step-by-step routing (names, sequence)
- [ ] Duration per step
- [ ] Equipment required per step (with alternatives if any)
- [ ] People required per step (by role or by name)
- [ ] Predecessor dependencies (which step must finish before the next starts)
- [ ] Timing constraints between steps (must be back-to-back? maximum gap allowed?)

---

## 4. Constraints — "What are the rules?"

These are the scheduling rules that make your problem hard. The more we know, the better the demo.

**Timing constraints**
- Must any steps be back-to-back? (e.g., "wet granulate must be dried within 30 minutes")
- Maximum gap between steps? (e.g., "surgery and recovery must start within 30 minutes")
- Minimum gap? (e.g., "allow 15 minutes for transport between buildings")

**Setup / Changeover times**
- Does switching between different products on the same equipment require setup time?
- Is it product-dependent? (e.g., "switching from Product A to B takes 2 hours, but A to A takes 15 minutes")
- Any sequence-dependent rules? (e.g., "always clean after antibiotics, regardless of next product")

**Material constraints**
- Do any jobs depend on material arriving? (e.g., "can't start until raw material lands Thursday")
- Any shared materials that multiple jobs compete for?

**Business rules**
- Priority rules — what makes one job more important than another?
- Any jobs that must NOT be moved? (locked / frozen / committed)
- Any resources that certain jobs cannot use? (e.g., "small reactor can't handle batch sizes over 300L")
- Campaign rules? (e.g., "prefer to run all Metformin batches back-to-back to minimize changeovers")

**For each constraint, we need:**
- [ ] What is the rule?
- [ ] Is it hard (must be enforced) or soft (preferred but flexible)?
- [ ] What happens when it's violated? (batch fails? quality issue? just inefficient?)

---

## 5. Current Pain Points — "What keeps you up at night?"

This helps us set up the demo to show the most relevant scenarios.

- [ ] What's your biggest scheduling headache today?
- [ ] How long does it take to build or update the schedule? (minutes? hours? all day?)
- [ ] How do you handle disruptions? (machine breakdown, rush order, absent operator)
- [ ] What questions do you wish you could answer instantly? (e.g., "can I fit this new order by Friday?")
- [ ] What's your bottleneck resource? (the one thing everything waits for)
- [ ] How often does the schedule change after it's published?
- [ ] What tools do you use today? (ERP, Excel, whiteboard, MES, custom software)
- [ ] How many people touch the schedule?

---

## 6. Planning Horizon — "How far ahead do you plan?"

- [ ] How far into the future does your schedule cover? (1 day? 1 week? 1 month?)
- [ ] How often do you re-plan? (every shift? daily? weekly?)
- [ ] Is there a frozen zone? (e.g., "don't change anything in the next 4 hours")

---

## 7. Terminology — "What do you call things?"

Every industry uses different words for the same concepts. We'll configure the system to speak your language.

| Our Term | Your Term |
|----------|-----------|
| Task / Operation | _________________ |
| Order / Work Order | _________________ |
| Resource / Equipment | _________________ |
| Routing / Process Plan | _________________ |
| Schedule / Production Plan | _________________ |
| Setup / Changeover | _________________ |
| Priority / Urgency | _________________ |

---

## What Format?

Send us whatever you have. We can work with:

- Excel spreadsheets (most common)
- CSV exports from your ERP
- PDF of your current schedule or Gantt chart
- Screenshots of your planning board
- A description in plain English — we'll ask clarifying questions

**The fastest path:** Export your routing master, resource list, and current open orders from your ERP. That's usually 3 Excel files and gives us 80% of what we need.

---

## What Happens Next

1. You send us the data (any format)
2. We map it to CTP's model (usually 1-2 days)
3. We load it and solve — you see YOUR schedule in the tool
4. We walk through it together and refine

The demo with your data is the real proof point. Generic demos show features. Your data shows value.
