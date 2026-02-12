"strict";
export class CTPUpdateModeConstants {
  public static UNCHANGED = 1;
  public static ADD = 2;
  public static UPDATE = 3;
  public static DELETE = 4;
}
export class CTPIntervalConstants {
  // Interval types
  public static REUSABLE = 1;
  public static CONSUMABLE = 2;
  public static START_TIMES = 3;
}

export class CTPEntityConstants {
  // Type of Entities
  public static RESOURCE = 1;
  public static OPERATION = 2;
  public static PROCESS = 3;
  public static JOB = 4;
  public static CALENDAR = 5;
}

export class CTPResourceTypeConstants {
  // Type of types
  public static POOL = 1;
  public static INDIVIDUAL = 2;
}

// Assignment types
export class CTPAssignmentConstants {
  public static UNAVAILABLE = 0;
  public static PROCESS = 1;
  public static CALENDAR = 2;
  public static CHANGE_OVER = 3;
  public static SETUP = 4;
  public static TEARDOWN = 5;
  public static TRANSPORT = 6;
  public static DURATION = 7;
  public static MAINTENANCE = 8;
  public static ONHOLD = 9;
  public static OVER_USAGE = 10;
  
  
}

// Available Matrix indexes
export class CTPDurationConstants {
  public static FIXED_DURATION = 0;
  public static FLOAT_DURATION = 1;
  public static UNTRACKED = 2;
  public static STATIC = 3;
  public static FIXED_RUN_RATE = 4;
  public static FLOAT_RUN_RATE = 5;
}

export class CTPStateChangeConstants {
  public static PROCESS_CHANGE = "PROCESS CHANGE";
  public static DEFAULT_PROCESS = "DEFAULT CHANGE";
  public static PROCESS_USAGE_LIMIT = "PROCESS USAGE";
  public static PROCESS_RUNTIME_LIMIT = "PROCESS RUNTIME";
  public static CLEAN_PROCESS = "CLEAN PROCESS";
}

export class CTPResourceConstants {
  public static REUSABLE = "REUSABLE";
  public static CONSUMABLE = "CONSUMABLE";
}
export class CTPTaskStateConstants {
  public static NOT_SCHEDULED = 0;
  public static SCHEDULED = 1;
}

export class CTPTaskTypeConstants {
  public static PROCESS = "PROCESS";
  public static SET_UP = "SETUP";
  public static TEAR_DOWN = "TEARDOWN";
}
export class CTPWipStateConstants {
  public static NOT_STARTED = 0;
  public static IN_PROCESS = 1;
  public static WAITING_NEXT = 2;
  public static ON_HOLD = 3;
  public static MAINTENANCE = 4;
  public static COMPLETED = 5;
}

export class CTPScoreObjectiveConstants {
  public static MINIMIZE = 0;
  public static MAXIMIZE = 1;
}
export class CTPScheduleDirectionConstants {
  // Type of types
  public static FORWARD = 1;
  public static BACKWARD = 2;
}
