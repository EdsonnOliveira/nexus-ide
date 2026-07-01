#include <napi.h>
#import <AppKit/AppKit.h>
#import <EventKit/EventKit.h>
#import <Foundation/Foundation.h>

#include <cmath>
#include <string>

namespace {

constexpr char kFieldDelimiter = '\u001f';
constexpr char kEntryDelimiter = '\u001e';

std::string NsStringToUtf8(NSString* value) {
  if (!value) {
    return "";
  }

  const char* utf8 = [value UTF8String];
  return utf8 ? std::string(utf8) : std::string();
}

std::string EscapeField(const std::string& value) {
  std::string result;
  result.reserve(value.size());

  for (const char character : value) {
    if (character == '\\') {
      result += "\\\\";
      continue;
    }

    if (character == kFieldDelimiter) {
      result += "\\u001f";
      continue;
    }

    if (character == kEntryDelimiter) {
      result += "\\u001e";
      continue;
    }

    if (character == '\n' || character == '\r') {
      result += ' ';
      continue;
    }

    result += character;
  }

  return result;
}

std::string HexFromColor(NSColor* color) {
  NSColor* rgb = [color colorUsingColorSpace:[NSColorSpace sRGBColorSpace]];

  if (!rgb) {
    return "#FFCC00";
  }

  const int red = static_cast<int>(std::lround(rgb.redComponent * 255.0));
  const int green = static_cast<int>(std::lround(rgb.greenComponent * 255.0));
  const int blue = static_cast<int>(std::lround(rgb.blueComponent * 255.0));
  char buffer[8];
  std::snprintf(buffer, sizeof(buffer), "#%02X%02X%02X", red, green, blue);
  return std::string(buffer);
}

void WaitForCalendarAccessResponse(dispatch_semaphore_t semaphore) {
  while (dispatch_semaphore_wait(semaphore, DISPATCH_TIME_NOW) != 0) {
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.05, true);
  }
}

bool HasCalendarReadAccess() {
  EKAuthorizationStatus status = [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];

  if (@available(macOS 14.0, *)) {
    return status == EKAuthorizationStatusFullAccess || status == EKAuthorizationStatusAuthorized;
  }

  return status == EKAuthorizationStatusAuthorized;
}

bool RequestCalendarAccessOnCurrentThread(EKEventStore* store) {
  if (HasCalendarReadAccess()) {
    return true;
  }

  if (@available(macOS 14.0, *)) {
    EKAuthorizationStatus status = [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];

    if (status == EKAuthorizationStatusWriteOnly) {
      return false;
    }

    if (status == EKAuthorizationStatusDenied || status == EKAuthorizationStatusRestricted) {
      return false;
    }
  } else {
    EKAuthorizationStatus status = [EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent];

    if (status == EKAuthorizationStatusDenied || status == EKAuthorizationStatusRestricted) {
      return false;
    }
  }

  if (NSApp == nil) {
    [NSApplication sharedApplication];
  }

  [NSApp activateIgnoringOtherApps:YES];

  __block bool granted = false;
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);

  if (@available(macOS 14.0, *)) {
    [store requestFullAccessToEventsWithCompletion:^(BOOL accessGranted, NSError* error) {
      granted = accessGranted || HasCalendarReadAccess();
      dispatch_semaphore_signal(semaphore);
    }];
  } else {
    [store requestAccessToEntityType:EKEntityTypeEvent
                          completion:^(BOOL accessGranted, NSError* error) {
                            granted = accessGranted || HasCalendarReadAccess();
                            dispatch_semaphore_signal(semaphore);
                          }];
  }

  WaitForCalendarAccessResponse(semaphore);
  return granted;
}

bool RequestCalendarAccess(EKEventStore* store) {
  if ([NSThread isMainThread]) {
    return RequestCalendarAccessOnCurrentThread(store);
  }

  __block bool granted = false;
  dispatch_semaphore_t done = dispatch_semaphore_create(0);

  dispatch_async(dispatch_get_main_queue(), ^{
    granted = RequestCalendarAccessOnCurrentThread(store);
    dispatch_semaphore_signal(done);
  });

  dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
  return granted;
}

std::string BuildEventsPayload(EKEventStore* store) {
  NSCalendar* calendar = [NSCalendar currentCalendar];
  NSDate* now = [NSDate date];
  NSDate* startOfDay = nil;
  [calendar rangeOfUnit:NSCalendarUnitDay startDate:&startOfDay interval:NULL forDate:now];

  if (!startOfDay) {
    return "ERROR";
  }

  NSDate* endOfDay = [calendar dateByAddingUnit:NSCalendarUnitDay value:1 toDate:startOfDay options:0];

  if (!endOfDay) {
    return "ERROR";
  }

  NSPredicate* predicate = [store predicateForEventsWithStartDate:startOfDay
                                                          endDate:endOfDay
                                                        calendars:nil];
  NSArray<EKEvent*>* events = [store eventsMatchingPredicate:predicate];
  NSArray<EKEvent*>* sortedEvents = [events sortedArrayUsingComparator:^NSComparisonResult(EKEvent* left, EKEvent* right) {
    NSComparisonResult dateComparison = [left.startDate compare:right.startDate];

    if (dateComparison != NSOrderedSame) {
      return dateComparison;
    }

    return [left.title compare:right.title];
  }];

  std::string output;
  const NSUInteger limit = MIN(sortedEvents.count, 12);

  for (NSUInteger index = 0; index < limit; index += 1) {
    EKEvent* event = sortedEvents[index];
    const std::string identifier = EscapeField(NsStringToUtf8(event.eventIdentifier));
    const std::string title = EscapeField(NsStringToUtf8(event.title ?: @"(Sem título)"));
    const std::string startMs = std::to_string(static_cast<long long>(event.startDate.timeIntervalSince1970 * 1000.0));
    const std::string endMs = std::to_string(static_cast<long long>(event.endDate.timeIntervalSince1970 * 1000.0));
    const std::string location = EscapeField(NsStringToUtf8(event.location));
    const std::string calendarName = EscapeField(NsStringToUtf8(event.calendar.title));
    const std::string colorHex = HexFromColor(event.calendar.color);
    const std::string allDay = event.isAllDay ? "1" : "0";

    output += identifier;
    output += kFieldDelimiter;
    output += title;
    output += kFieldDelimiter;
    output += startMs;
    output += kFieldDelimiter;
    output += endMs;
    output += kFieldDelimiter;
    output += location;
    output += kFieldDelimiter;
    output += calendarName;
    output += kFieldDelimiter;
    output += colorHex;
    output += kFieldDelimiter;
    output += allDay;
    output += kEntryDelimiter;
  }

  return output;
}

std::string FetchTodayEvents() {
  EKEventStore* store = [[EKEventStore alloc] init];

  if (!RequestCalendarAccess(store)) {
    return "DENIED";
  }

  return BuildEventsPayload(store);
}

Napi::Value GetTodayEvents(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return Napi::String::New(env, FetchTodayEvents());
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("getTodayEvents", Napi::Function::New(env, GetTodayEvents));
  return exports;
}

NODE_API_MODULE(macos_calendar, Init)

}  // namespace
