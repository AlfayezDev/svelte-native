package expo.modules.svelteengine

import androidx.autofill.HintConstants

/**
 * The autofill hint of each `autoComplete` name a text input takes on Android: React Native's own table (`ReactTextInputManager.REACT_PROPS_AUTOFILL_HINTS_MAP`,
 * 0.88.1), which `src/test/run.sh` compares with this one entry by entry (`InputRulesCheck`). The JavaScript side turns HTML's tokens into these names first
 * (`src/text-input-props.ts`: `new-password` is `password-new`, `one-time-code` is `sms-otp`). A name that is not here turns autofill off for the field
 * (`InputRules.autofillMode`).
 */
object InputAutofill {
  private val HINTS: Map<String, String> = mapOf(
    "2fa-app-otp" to HintConstants.AUTOFILL_HINT_2FA_APP_OTP,
    "birthdate-day" to HintConstants.AUTOFILL_HINT_BIRTH_DATE_DAY,
    "birthdate-full" to HintConstants.AUTOFILL_HINT_BIRTH_DATE_FULL,
    "birthdate-month" to HintConstants.AUTOFILL_HINT_BIRTH_DATE_MONTH,
    "birthdate-year" to HintConstants.AUTOFILL_HINT_BIRTH_DATE_YEAR,
    "cc-csc" to HintConstants.AUTOFILL_HINT_CREDIT_CARD_SECURITY_CODE,
    "cc-exp" to HintConstants.AUTOFILL_HINT_CREDIT_CARD_EXPIRATION_DATE,
    "cc-exp-day" to HintConstants.AUTOFILL_HINT_CREDIT_CARD_EXPIRATION_DAY,
    "cc-exp-month" to HintConstants.AUTOFILL_HINT_CREDIT_CARD_EXPIRATION_MONTH,
    "cc-exp-year" to HintConstants.AUTOFILL_HINT_CREDIT_CARD_EXPIRATION_YEAR,
    "cc-number" to HintConstants.AUTOFILL_HINT_CREDIT_CARD_NUMBER,
    "email" to HintConstants.AUTOFILL_HINT_EMAIL_ADDRESS,
    "email-otp" to HintConstants.AUTOFILL_HINT_EMAIL_OTP,
    "flight-confirmation-code" to HintConstants.AUTOFILL_HINT_FLIGHT_CONFIRMATION_CODE,
    "flight-number" to HintConstants.AUTOFILL_HINT_FLIGHT_NUMBER,
    "gender" to HintConstants.AUTOFILL_HINT_GENDER,
    "gift-card-number" to HintConstants.AUTOFILL_HINT_GIFT_CARD_NUMBER,
    "gift-card-pin" to HintConstants.AUTOFILL_HINT_GIFT_CARD_PIN,
    "loyalty-account-number" to HintConstants.AUTOFILL_HINT_LOYALTY_ACCOUNT_NUMBER,
    "name" to HintConstants.AUTOFILL_HINT_PERSON_NAME,
    "name-family" to HintConstants.AUTOFILL_HINT_PERSON_NAME_FAMILY,
    "name-given" to HintConstants.AUTOFILL_HINT_PERSON_NAME_GIVEN,
    "name-middle" to HintConstants.AUTOFILL_HINT_PERSON_NAME_MIDDLE,
    "name-middle-initial" to HintConstants.AUTOFILL_HINT_PERSON_NAME_MIDDLE_INITIAL,
    "name-prefix" to HintConstants.AUTOFILL_HINT_PERSON_NAME_PREFIX,
    "name-suffix" to HintConstants.AUTOFILL_HINT_PERSON_NAME_SUFFIX,
    "password" to HintConstants.AUTOFILL_HINT_PASSWORD,
    "password-new" to HintConstants.AUTOFILL_HINT_NEW_PASSWORD,
    "postal-address" to HintConstants.AUTOFILL_HINT_POSTAL_ADDRESS,
    "postal-address-country" to HintConstants.AUTOFILL_HINT_POSTAL_ADDRESS_COUNTRY,
    "postal-address-dependent-locality" to HintConstants.AUTOFILL_HINT_POSTAL_ADDRESS_DEPENDENT_LOCALITY,
    "postal-address-extended" to HintConstants.AUTOFILL_HINT_POSTAL_ADDRESS_EXTENDED_ADDRESS,
    "postal-address-extended-postal-code" to HintConstants.AUTOFILL_HINT_POSTAL_ADDRESS_EXTENDED_POSTAL_CODE,
    "postal-address-locality" to HintConstants.AUTOFILL_HINT_POSTAL_ADDRESS_LOCALITY,
    "postal-address-region" to HintConstants.AUTOFILL_HINT_POSTAL_ADDRESS_REGION,
    "postal-address-unit" to HintConstants.AUTOFILL_HINT_POSTAL_ADDRESS_APT_NUMBER,
    "postal-code" to HintConstants.AUTOFILL_HINT_POSTAL_CODE,
    "promo-code" to HintConstants.AUTOFILL_HINT_PROMO_CODE,
    "street-address" to HintConstants.AUTOFILL_HINT_POSTAL_ADDRESS_STREET_ADDRESS,
    "sms-otp" to HintConstants.AUTOFILL_HINT_SMS_OTP,
    "tel" to HintConstants.AUTOFILL_HINT_PHONE_NUMBER,
    "tel-country-code" to HintConstants.AUTOFILL_HINT_PHONE_COUNTRY_CODE,
    "tel-national" to HintConstants.AUTOFILL_HINT_PHONE_NATIONAL,
    "tel-device" to HintConstants.AUTOFILL_HINT_PHONE_NUMBER_DEVICE,
    "upi-vpa" to HintConstants.AUTOFILL_HINT_UPI_VPA,
    "wifi-password" to HintConstants.AUTOFILL_HINT_WIFI_PASSWORD,
    "username" to HintConstants.AUTOFILL_HINT_USERNAME,
    "username-new" to HintConstants.AUTOFILL_HINT_NEW_USERNAME,
  )

  /** The hint of [name], or null for none (no name, `"off"`, or a name Android has no hint for). */
  fun hintOf(name: String?): String? = name?.let { HINTS[it] }
}
