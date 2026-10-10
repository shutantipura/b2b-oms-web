export const DELIVERY_RULES = {
  timezone: "Asia/Bangkok",

  // CURRENT RULES.
  // Change these later when the business decides.
  sameDayCutoffMinutes: 10 * 60,
  nextDayCutoffMinutes: 20 * 60,

  daysToShow: 7,

  slots: [
    {
      value: "07:00–09:00",
      label: "07:00–09:00",
      startMinutes: 7 * 60,
    },
    {
      value: "09:00–11:00",
      label: "09:00–11:00",
      startMinutes: 9 * 60,
    },
    {
      value: "11:00–13:00",
      label: "11:00–13:00",
      startMinutes: 11 * 60,
    },
    {
      value: "13:00–15:00",
      label: "13:00–15:00",
      startMinutes: 13 * 60,
    },
    {
      value: "15:00–17:00",
      label: "15:00–17:00",
      startMinutes: 15 * 60,
    },
  ],
};

type BangkokNow = {
  date: string;
  minutes: number;
};

function getBangkokNow(
  now = new Date()
): BangkokNow {
  const formatter =
    new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone:
          DELIVERY_RULES.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }
    );

  const parts =
    formatter.formatToParts(
      now
    );

  const get = (
    type: string
  ) =>
    parts.find(
      (part) =>
        part.type === type
    )?.value ?? "";

  const year =
    get("year");

  const month =
    get("month");

  const day =
    get("day");

  const hour =
    Number(
      get("hour")
    );

  const minute =
    Number(
      get("minute")
    );

  return {
    date:
      `${year}-${month}-${day}`,

    minutes:
      hour * 60 +
      minute,
  };
}

function addDays(
  dateString: string,
  days: number
) {
  const [
    year,
    month,
    day,
  ] =
    dateString
      .split("-")
      .map(Number);

  const date =
    new Date(
      Date.UTC(
        year,
        month - 1,
        day
      )
    );

  date.setUTCDate(
    date.getUTCDate() +
      days
  );

  return date
    .toISOString()
    .slice(0, 10);
}

export function getEarliestDeliveryDate(
  now = new Date()
) {
  const bangkok =
    getBangkokNow(now);

  // Before 10:00:
  // same day is possible.
  if (
    bangkok.minutes <
    DELIVERY_RULES
      .sameDayCutoffMinutes
  ) {
    return bangkok.date;
  }

  // 10:00–19:59:
  // earliest is tomorrow.
  if (
    bangkok.minutes <
    DELIVERY_RULES
      .nextDayCutoffMinutes
  ) {
    return addDays(
      bangkok.date,
      1
    );
  }

  // 20:00 onwards:
  // earliest is day after tomorrow.
  return addDays(
    bangkok.date,
    2
  );
}

export function getAvailableSlots(
  deliveryDate: string,
  now = new Date()
) {
  const bangkok =
    getBangkokNow(now);

  const earliest =
    getEarliestDeliveryDate(
      now
    );

  if (
    deliveryDate <
    earliest
  ) {
    return [];
  }

  // Future dates:
  // all slots available.
  if (
    deliveryDate !==
    bangkok.date
  ) {
    return [
      ...DELIVERY_RULES.slots,
    ];
  }

  // Same day:
  // slot must not already
  // have started.
  return DELIVERY_RULES
    .slots
    .filter(
      (slot) =>
        slot.startMinutes >
        bangkok.minutes
    );
}

export function getDeliveryOptions(
  now = new Date()
) {
  const firstDate =
    getEarliestDeliveryDate(
      now
    );

  return Array.from(
    {
      length:
        DELIVERY_RULES
          .daysToShow,
    },
    (_, index) => {
      const date =
        addDays(
          firstDate,
          index
        );

      return {
        date,

        slots:
          getAvailableSlots(
            date,
            now
          ).map(
            (slot) => ({
              value:
                slot.value,

              label:
                slot.label,
            })
          ),
      };
    }
  );
}

export function validateDeliverySelection(
  deliveryDate: string,
  deliverySlot: string,
  now = new Date()
) {
  const options =
    getDeliveryOptions(
      now
    );

  const dateOption =
    options.find(
      (option) =>
        option.date ===
        deliveryDate
    );

  if (!dateOption) {
    return {
      valid: false,
      message:
        "That delivery date is not currently available.",
    };
  }

  const validSlot =
    dateOption.slots.some(
      (slot) =>
        slot.value ===
        deliverySlot
    );

  if (!validSlot) {
    return {
      valid: false,
      message:
        "That delivery time is no longer available. Please select another slot.",
    };
  }

  return {
    valid: true,
    message: "",
  };
}