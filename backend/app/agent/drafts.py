"""Letter and affidavit TEMPLATES (plan section 3.4, action_draft). Every fact is a [____] blank.

We never fill in facts the user hasn't confirmed and never invent any. These are starting points the user
completes, signs, and where needed gets notarised or checked by a lawyer.
"""

HEADER = (
    "DRAFT TEMPLATE. Not valid until you fill in every [____] blank and sign it. "
    "Ask your Passport Office or a lawyer whether it must be notarised or attested."
)

NAME_AFFIDAVIT = f"""{HEADER}

AFFIDAVIT FOR NAME DIFFERENCE

I, [____] (full name as on my passport application), son/daughter/wife of [____], \
aged [____] years, resident of [____], \
do hereby solemnly affirm and declare as follows:

1. That my name is recorded as "[____]" in my [____] (document, number last 4 digits only: [____]).
2. That my name is recorded as "[____]" in my [____] (document, number last 4 digits only: [____]).
3. That both names refer to one and the same person, that is, me.
4. That the difference arose because [____].
5. That I am applying for a passport and have not concealed any information.

DEPONENT
Place: [____]    Date: [____]    Signature: [____]

VERIFICATION
Verified at [____] on [____] that the contents above are true to the best of my knowledge and belief.
Attestation as required by the Passport Office: [____]
"""

RPO_LETTER = f"""{HEADER}

To,
The Passport Officer,
Regional Passport Office, [____]

Subject: Request for status review of passport application, file number [____]

Respected Sir/Madam,

I, [____], applied for a passport at [____] Passport Seva Kendra on [____] (file number [____]).
My application status shows "[____]" and has not changed since [____].

[____] (one or two sentences: the specific problem, for example police verification pending, an address \
mismatch, or a file-closure reason quoted exactly from the notice).

I request that my case be reviewed and that I be told what further document or step, if any, is needed.
I am enclosing: [____] (list only documents you are actually attaching).

Thank you.

Yours faithfully,
[____]
Mobile: [____]    Email: [____]
Date: [____]
"""

TEMPLATES = {
    "name_discrepancy": NAME_AFFIDAVIT,
    "name_change_marriage": NAME_AFFIDAVIT,
    "adverse_pv": RPO_LETTER,
    "pv_delay": RPO_LETTER,
    "address_mismatch": RPO_LETTER,
}


def draft_for(category: str) -> str | None:
    return TEMPLATES.get(category)
